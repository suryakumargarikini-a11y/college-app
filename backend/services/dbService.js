/**
 * SITAM Smart ERP — Database Service
 *
 * Prisma client singleton with production connection pool tuning
 * and slow query logging (queries >200ms flagged as warnings).
 */

const { PrismaClient } = require('@prisma/client');
const logger = require('./logger');

const SLOW_QUERY_THRESHOLD_MS = parseInt(process.env.DB_SLOW_QUERY_MS || '200', 10);
const CONNECTION_LIMIT = parseInt(process.env.DB_CONNECTION_LIMIT || '20', 10);

// Build datasource URL with connection pool params if using PostgreSQL
// Prisma uses connection_limit and pool_timeout as URL query params
function buildDatabaseUrl() {
    const rawUrl = process.env.DATABASE_URL || '';
    if (!rawUrl || rawUrl.startsWith('file:')) {
        return rawUrl; // SQLite — no pool params
    }

    try {
        const url = new URL(rawUrl);
        // Set connection pool size and timeout
        url.searchParams.set('connection_limit', CONNECTION_LIMIT.toString());
        url.searchParams.set('pool_timeout', '30'); // 30s wait before pool exhaustion error
        url.searchParams.set('connect_timeout', '10'); // 10s initial connection timeout
        return url.toString();
    } catch (_) {
        return rawUrl;
    }
}

// Detect the actual DB provider so telemetry labels are correct.
// This is evaluated once at module load after dotenv has injected env.
const _rawDbUrl = typeof process.env.DATABASE_URL === 'string' ? process.env.DATABASE_URL : '';
const DB_SYSTEM = (_rawDbUrl.startsWith('postgresql') || _rawDbUrl.startsWith('postgres'))
    ? 'postgresql'
    : 'sqlite';


const prisma = new PrismaClient({
    datasources: {
        db: { url: buildDatabaseUrl() }
    },
    log: [
        { level: 'query', emit: 'event' },
        { level: 'error', emit: 'event' },
        { level: 'warn',  emit: 'event' },
    ],
});

// ── Slow Query Logging & Metrics ───────────────────────────────────────────────
prisma.$on('query', (e) => {
    const duration = e.duration; // milliseconds
    
    try {
        const metricsService = require('./metricsService');
        metricsService.metrics.postgresQueryDuration.observe(duration / 1000);
        
        if (duration >= SLOW_QUERY_THRESHOLD_MS) {
            metricsService.metrics.postgresSlowQueriesTotal.inc();
            
            logger.warn(`[DB] Slow query detected: ${duration}ms — ${e.query.substring(0, 200)}`, {
                duration,
                params: e.params,
            });
            metricsService.observe('api_request_duration_ms', 'db:slow_query', duration);
        }
    } catch (_) {}
});

let activeConnectionsCount = 0;

// Middleware to track active query count (connection pool active connections estimate)
prisma.$use(async (params, next) => {
    try {
        const metricsService = require('./metricsService');
        metricsService.metrics.postgresPoolActiveConnections.inc();
    } catch (_) {}

    activeConnectionsCount++;
    if (activeConnectionsCount >= CONNECTION_LIMIT * 0.85) {
        logger.warn(`[DB] Connection pool approaching saturation: ${activeConnectionsCount}/${CONNECTION_LIMIT} active connections`, {
            activeConnections: activeConnectionsCount,
            limit: CONNECTION_LIMIT,
            model: params.model,
            action: params.action
        });
    }

    const { traceSpan } = require('../telemetry/tracing');
    const model = params.model || 'System';
    const action = params.action || 'query';

    return traceSpan(`db.${model.toLowerCase()}.${action}`, {
        'db.system': DB_SYSTEM,
        'db.operation': action,
        'db.model': model,
        'db.statement': `${model}.${action}`,
        'dependency.type': 'database',
        'dependency.name': DB_SYSTEM,
        'dependency.category': 'relational_db',
        'dependency.criticality': 'high'
    }, async (span) => {
        try {
            const start = Date.now();
            const result = await next(params);
            const duration = Date.now() - start;

            // Trace query level details in debug logs
            logger.debug(`[DB] Executed ${model}.${action} (${duration}ms)`);
            
            // Validate SLO (200ms slow query threshold)
            if (duration > 200) {
                span.setAttribute('anomaly', true);
                span.setAttribute('anomaly.type', 'db_slow_query');
                span.setAttribute('anomaly.severity', 'medium');
            }

            return result;
        } catch (err) {
            // Detect deadlock/lock contention issues
            const isLockContention = err.code === 'P2034' || 
                                     (err.message && (err.message.includes('deadlock') || err.message.includes('lock timeout') || err.message.includes('serialization')));
            
            if (isLockContention) {
                span.addEvent('db_lock_detected', { error: err.message, code: err.code });
                span.setAttribute('anomaly', true);
                span.setAttribute('anomaly.type', 'db_lock_contention');
                span.setAttribute('anomaly.severity', 'critical');
            } else {
                span.setAttribute('anomaly', true);
                span.setAttribute('anomaly.type', 'db_query_failure');
                span.setAttribute('anomaly.severity', 'high');
            }

            logger.error(`[DB] Query failed on ${model}.${action}: ${err.message}`, {
                code: err.code,
                model: model,
                action: action,
                lockContention: isLockContention,
                tag: isLockContention ? 'DB_LOCK_CONTENTION' : 'DB_FAILURE'
            });
            throw err;
        } finally {
            activeConnectionsCount--;
            try {
                const metricsService = require('./metricsService');
                metricsService.metrics.postgresPoolActiveConnections.dec();
            } catch (_) {}
        }
    });
});

prisma.$on('error', (e) => {
    const isLockContention = e.message && (e.message.includes('deadlock') || e.message.includes('lock timeout'));
    logger.error(`[DB] Prisma error event: ${e.message}`, { 
        target: e.target,
        lockContention: isLockContention,
        tag: isLockContention ? 'DB_LOCK_CONTENTION' : 'DB_FAILURE'
    });
});

prisma.$on('warn', (e) => {
    logger.warn(`[DB] Prisma warning event: ${e.message}`);
});

logger.info(`[DB] PrismaClient initialized (connection_limit=${CONNECTION_LIMIT}, slow_query_threshold=${SLOW_QUERY_THRESHOLD_MS}ms)`);

// If SQLite, enable WAL mode for high concurrency.
// IMPORTANT: SQLite's PRAGMA journal_mode=WAL returns a result set ({'journal_mode':'wal'}).
// We MUST use $queryRawUnsafe (SELECT-style) NOT $executeRawUnsafe (DML-only).
// Using $executeRawUnsafe causes: "Execute returned results, which is not allowed in SQLite"
// Also guard typeof to prevent undefined.startsWith() when env is not yet loaded at module init.
const _dbUrl = typeof process.env.DATABASE_URL === 'string' ? process.env.DATABASE_URL : '';
if (_dbUrl.startsWith('file:')) {
    prisma.$queryRawUnsafe('PRAGMA journal_mode=WAL;')
        .then(() => logger.info('[DB] SQLite WAL (Write-Ahead Logging) mode enabled successfully.'))
        .catch(err => logger.error(`[DB] Failed to enable SQLite WAL mode: ${err.message}`));
}

module.exports = prisma;

