try {
    const path = require('path');
    require('dotenv').config({ path: path.join(__dirname, '.env'), override: true });
} catch (err) {
    console.warn('[Server] Note: dotenv module not found. Relying on system environment variables.');
}

if (process.env.NODE_ENV === 'production' || process.env.RENDER) {
    try {
        require('./scripts/use-pg');
    } catch (err) {
        console.error('[Startup] Failed to switch database provider to PostgreSQL:', err.message);
    }
}

require('./telemetry/tracing');
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const { responseStandardizer, errorHandler } = require('./middleware/errorHandler');
const correlationMiddleware = require('./middleware/correlationMiddleware');
const logger = require('./services/logger');
const redisService = require('./services/redisService');
const prisma = require('./services/dbService');
const workerService = require('./services/workerService');
const metricsService = require('./services/metricsService');
const circuitBreaker = require('./services/circuitBreaker');
const observabilityScheduler = require('./services/ObservabilityScheduler');
const sreScheduler = require('./services/SREScheduler');
const devSecOpsScheduler = require('./services/DevSecOpsScheduler');
const feeReminderScheduler = require('./services/feeReminderScheduler');


const app = express();
const PORT = process.env.PORT || 8080;

// ─── Initialize Infrastructure ────────────────────────────────────────────────
redisService.connect();
workerService.init();

// ─── Security Headers ─────────────────────────────────────────────────────────
app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false
}));

const corsWhitelist = [
    'capacitor://localhost',
    'http://localhost',
    'https://localhost',
    'http://localhost:5173',
    'http://localhost:3000',
    'https://sitamecap.co.in',
    'https://admin.sitamecap.co.in'
];
if (process.env.ALLOWED_ORIGINS) {
    const extraOrigins = process.env.ALLOWED_ORIGINS.split(',').map(item => item.trim()).filter(Boolean);
    corsWhitelist.push(...extraOrigins);
}
app.use(cors({
    origin: (origin, callback) => {
        if (!origin || corsWhitelist.includes(origin) || origin.startsWith('chrome-extension://')) {
            callback(null, true);
        } else {
            logger.warn(`[CORS] Blocked request from unauthorized origin: ${origin}`);
            callback(null, false);
        }
    },
    credentials: true
}));

// ─── Request Parsing ──────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// ─── Correlation IDs ──────────────────────────────────────────────────────────
app.use(correlationMiddleware);


// ─── Multi-Tenant Resource Sovereignty & Throttling Middleware ──────────────
// IMPORTANT: Auth routes (/api/auth/*) are EXEMPT from tenant throttling.
// Throttling login would add 1s+ DB latency before every authentication attempt.
// Monitoring still tracks quota, but NEVER delays or blocks auth requests.
const sreService = require('./services/sreService');
app.use(async (req, res, next) => {
    // Auth requests must never be throttled — bypass SRE tenancy middleware entirely
    const isAuthRoute = req.path.startsWith('/auth') || req.path.startsWith('/api/auth');
    if (isAuthRoute) {
        return next();
    }

    const userId = req.headers['x-student-id'] || (req.body && req.body.userId) || req.query.userId || req.headers['x-user-id'];
    if (userId) {
        req.tenantUserId = userId;
        try {
            const tenantQuota = await sreService.registerTenantRequest(userId);

            if (tenantQuota.isThrottled) {
                // Log throttle but do NOT delay the request — only add the header
                logger.warn(`[SRE-Tenancy] Tenant ${userId} quota exceeded — marking throttled (no artificial delay on ERP routes)`);
                res.setHeader('Retry-After', '5');
                res.setHeader('X-Throttled', 'true');
            }

            res.on('finish', () => {
                sreService.releaseTenantRequest(userId).catch(err =>
                    logger.warn(`[SRE-Tenancy] releaseTenantRequest failed: ${err.message}`)
                );
            });
        } catch (sreErr) {
            // SRE errors MUST NEVER block the request
            logger.warn(`[SRE-Tenancy] Middleware error (non-blocking): ${sreErr.message}`);
        }
    }
    next();
});

// ─── Request Latency Logging + Metrics ───────────────────────────────────────
app.use((req, res, next) => {
    const start = Date.now();
    const routePath = req.route ? req.route.path : req.path;
    const method = req.method;

    metricsService.metrics.activeHttpRequests.inc({ method, route: routePath });

    res.on('finish', () => {
        const durationMs = Date.now() - start;
        const requestId = req.requestId || '-';
        const traceId = req.traceId || '-';
        const correlationId = req.correlationId || '-';
        const finalRoutePath = req.route ? req.route.path : req.path;

        metricsService.metrics.activeHttpRequests.dec({ method, route: routePath });

        const logMetadata = {
            requestId,
            traceId,
            correlationId,
            method,
            route: finalRoutePath,
            status: res.statusCode,
            durationMs,
            ip: req.ip,
            userAgent: req.headers['user-agent']
        };

        if (res.statusCode >= 500) {
            logger.error(`[API] Failed Request: ${method} ${finalRoutePath} ${res.statusCode} — ${durationMs}ms`, logMetadata);
        } else if (durationMs > 500) {
            logger.warn(`[API] Slow Request: ${method} ${finalRoutePath} ${res.statusCode} — ${durationMs}ms`, logMetadata);
        } else {
            logger.info(`[API] Request Processed: ${method} ${finalRoutePath} ${res.statusCode} — ${durationMs}ms`, logMetadata);
        }

        metricsService.recordRequest(method, finalRoutePath, res.statusCode, durationMs);
    });
    next();
});

// ─── Infrastructure Routes (BEFORE rate limiter — never throttled) ────────────
// Health probes and Prometheus metrics are exempt from rate limiting.
// Registering them before app.use('/api', generalLimiter) ensures they bypass it.

app.get('/api/health/liveness', (req, res) => {
    res.status(200).json({
        status: 'alive',
        timestamp: new Date().toISOString(),
        uptime: Math.floor(process.uptime()) + 's'
    });
});

app.get('/api/health/readiness', async (req, res) => {
    const checks = {};
    let allReady = true;

    try {
        await prisma.$queryRaw`SELECT 1`;
        const rawUrl = process.env.DATABASE_URL || '';
        const provider = rawUrl.startsWith('postgresql') || rawUrl.startsWith('postgres') ? 'postgresql' : 'sqlite';
        checks.database = { status: 'ready', provider };
    } catch (err) {
        logger.error(`[Health] DB check failed: ${err.message}`, { requestId: req.requestId });
        checks.database = { status: 'unavailable', error: err.message };
        allReady = false;
    }

    checks.redis = redisService.isAlive()
        ? { status: 'ready' }
        : { status: 'offline', note: 'In-memory fallback active' };

    const browserPool = require('./services/browserPool');
    checks.browserPool = browserPool.getStatus();
    checks.circuitBreaker = circuitBreaker.getStatus();

    const statusCode = allReady ? 200 : 503;
    res.status(statusCode).json({
        status: allReady ? 'ready' : 'degraded',
        checks,
        metrics: await metricsService.snapshot(),
        timestamp: new Date().toISOString()
    });
});

// Legacy health check (backward compatibility)
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Production-ready Health Check
app.get('/health', (req, res) => {
    res.json({
        status: "ok",
        version: process.env.APP_VERSION || "1.0.0"
    });
});

// Production-ready ERP diagnostics
app.get('/health/erp', async (req, res) => {
    const diagnostics = {
        timestamp: new Date().toISOString(),
        provider: 'unknown',
        erpConnectivity: 'unknown',
        sessionServiceStatus: 'unknown',
        authenticationSystem: 'unknown'
    };

    try {
        const { ProviderFactory } = require('./providers');
        const provider = ProviderFactory.getProvider();
        diagnostics.provider = provider.providerName;
        
        // 1. Check ERP connectivity
        const start = Date.now();
        const erpHealth = await provider.checkERPHealth();
        diagnostics.erpConnectivity = {
            status: erpHealth.healthy ? 'healthy' : 'unreachable',
            responseTimeMs: erpHealth.responseTimeMs,
            details: erpHealth.details
        };

        // 2. Check Session Service Status
        const sessionManager = require('./providers/session/ProviderSessionManager');
        const activeSessions = await sessionManager.getActiveSessions();
        diagnostics.sessionServiceStatus = {
            status: 'active',
            redisConnected: redisService.isAlive(),
            activeSessionCount: activeSessions.length
        };

        // 3. Check Authentication System
        diagnostics.authenticationSystem = {
            status: 'active',
            mode: process.env.NODE_ENV || 'production'
        };

        const healthy = erpHealth.healthy;
        res.status(healthy ? 200 : 503).json({
            status: healthy ? 'ok' : 'degraded',
            diagnostics
        });
    } catch (err) {
        logger.error(`[Health ERP] Check failed: ${err.message}`);
        res.status(500).json({
            status: 'error',
            error: err.message,
            diagnostics
        });
    }
});

// Prometheus Metrics — unauthenticated, protect at network layer in production
app.get('/api/metrics', async (req, res) => {
    const requiredToken = process.env.METRICS_BEARER_TOKEN;
    if (requiredToken) {
        const authHeader = req.headers.authorization || '';
        if (authHeader !== `Bearer ${requiredToken}`) {
            return res.status(401).send('Unauthorized');
        }
    }
    const browserPool = require('./services/browserPool');
    const poolStatus = browserPool.getStatus();

    const isJson = req.query.format === 'json' || (req.headers.accept && req.headers.accept.includes('application/json'));
    if (isJson) {
        try {
            const syncService = require('./services/syncService');
            const cachedCount = await prisma.student.count().catch(() => 0);
            const heapUsedMB = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
            const rssMB = Math.round(process.memoryUsage().rss / 1024 / 1024);

            const authQueued = poolStatus.authPool ? poolStatus.authPool.queued : 0;
            const syncQueued = poolStatus.syncPool ? poolStatus.syncPool.queued : 0;

            const authActive = poolStatus.authPool ? poolStatus.authPool.active : 0;
            const syncActive = poolStatus.syncPool ? poolStatus.syncPool.active : 0;

            const authLaunching = poolStatus.authPool ? poolStatus.authPool.launching : 0;
            const syncLaunching = poolStatus.syncPool ? poolStatus.syncPool.launching : 0;

            return res.json({
                browserPool: {
                    active: authActive + syncActive,
                    launching: authLaunching + syncLaunching,
                    waiting: authQueued + syncQueued
                },
                sync: {
                    running: syncService._syncInFlight ? syncService._syncInFlight.size : 0,
                    cached: cachedCount,
                    scraping: syncActive
                },
                circuitBreaker: {
                    state: circuitBreaker.state
                },
                memory: {
                    heapUsedMB,
                    rssMB
                }
            });
        } catch (err) {
            logger.error(`[Metrics] JSON metrics build failed: ${err.message}`);
            return res.status(500).json({ error: 'Failed to collect JSON metrics' });
        }
    }

    // ── Backward-compat unlabelled gauges (combined totals) ───────────────
    metricsService.metrics.browserPoolActiveBrowsers.set(poolStatus.total);
    metricsService.metrics.browserPoolActiveContexts.set(poolStatus.active);

    // ── Per-pool labeled gauges (AUTH_POOL / SYNC_POOL) ───────────────────
    if (poolStatus.authPool) {
        const auth = poolStatus.authPool;
        metricsService.metrics.browserPoolBrowsersByPool.set({ pool: 'auth' }, auth.total);
        metricsService.metrics.browserPoolActiveByPool.set({ pool: 'auth' }, auth.active);
        metricsService.metrics.browserPoolQueueDepthByPool.set({ pool: 'auth' }, auth.queued);
        if (auth.metrics) {
            metricsService.metrics.browserPoolAvgWaitMsByPool.set(
                { pool: 'auth' }, auth.metrics.avgWaitMs || 0
            );
        }
    }
    if (poolStatus.syncPool) {
        const sync = poolStatus.syncPool;
        metricsService.metrics.browserPoolBrowsersByPool.set({ pool: 'sync' }, sync.total);
        metricsService.metrics.browserPoolActiveByPool.set({ pool: 'sync' }, sync.active);
        metricsService.metrics.browserPoolQueueDepthByPool.set({ pool: 'sync' }, sync.queued);
        if (sync.metrics) {
            metricsService.metrics.browserPoolAvgWaitMsByPool.set(
                { pool: 'sync' }, sync.metrics.avgWaitMs || 0
            );
        }
    }

    const socketService = require('./services/socketService');
    const activeWs = socketService.wss ? socketService.wss.clients.size : 0;
    metricsService.metrics.websocketConnectionsActive.set(activeWs);

    res.setHeader('Content-Type', metricsService.register.contentType);
    res.send(await metricsService.register.metrics());
});

app.get('/api/health/circuit', (req, res) => {
    res.json(circuitBreaker.getStatus());
});

app.post('/api/health/circuit/reset', (req, res) => {
    circuitBreaker.reset();
    logger.info('[Server] Circuit breaker manually reset via API', { requestId: req.requestId });
    res.json({ success: true, status: circuitBreaker.getStatus() });
});

// ─── SRE Control Plane ────────────────────────────────────────────────────────
const sreRoutes = require('./routes/sre');
app.use('/api/sre', sreRoutes);

// ─── Browser Pool Metrics ─────────────────────────────────────────────────────
// GET  /api/browserpool        — full pool status (auth + sync pool metrics)
// GET  /api/browserpool/health — lightweight health check for uptime monitors
// POST /api/browserpool/drain  — operator: graceful drain + reinitialize
const browserPoolRoutes = require('./routes/browserPool');
app.use('/api/browserpool', browserPoolRoutes);

// ─── Rate Limiting (applied AFTER infra routes) ───────────────────────────────
//
// Dual-key strategy:
//  • Authenticated requests (verified Bearer token): 300 req / 15 min PER STUDENT ID
//    → the stable userId is extracted from the in-memory session map (O(1) Map.get).
//      This is safe because the auth middleware's getSessionAsync() already restores
//      cold-start sessions from DB before any /api route handler runs.
//    → Using userId instead of token tail means token refreshes for the same student
//      continue sharing the same rate-limit bucket instead of creating a new one.
//  • Unauthenticated requests: 60 req / 15 min PER IP
//    → still protects against scrapers / bots on public endpoints.
//
// Skip list (never rate-limited):
//  • /api/health, /api/health/*, /api/health/liveness, /api/health/readiness
//  • /api/metrics  — Prometheus scraper
//  • /favicon.ico  — browser pre-fetch; not an API call
//  These are registered before this middleware, but the skip guard provides an
//  extra safety net so monitoring systems can never consume rate-limit quotas.
const sessionManagerForLimiter = require('./services/sessionManager');

const generalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 300,                        // per-student bucket — generous for normal ERP usage
    standardHeaders: true,
    legacyHeaders: false,
    validate: false,
    // ── Key generator: stable userId for authenticated sessions ─────────────
    keyGenerator: (req) => {
        const auth = req.headers.authorization || '';
        if (auth.startsWith('Bearer ')) {
            const token = auth.slice(7); // strip "Bearer "
            // Synchronous in-memory lookup — O(1) Map.get.
            // Sessions are already restored from DB by auth middleware before this runs.
            const session = sessionManagerForLimiter.getSession(token);
            if (session && session.userId) {
                // Prefix prevents accidental collision with raw IP strings
                return 'uid_' + session.userId;
            }
            // Token present but not yet in memory (unauthenticated route, no requireAuth):
            // fall back to token suffix so it still gets an isolated bucket
            return 'tok_' + token.slice(-32);
        }
        return req.ip;
    },
    // ── Skip list: monitoring endpoints must never consume rate-limit quota ──
    skip: (req) => {
        const p = req.path;
        return (
            p === '/api/health'            ||
            p.startsWith('/api/health/')   ||  // /api/health/liveness, /api/health/readiness, etc.
            p === '/api/metrics'           ||
            p === '/favicon.ico'
        );
    },
    message: { error: 'Too many requests. Please try again after 15 minutes.' }
});
app.use('/api', generalLimiter);

const syncLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 60, // Raised from 20 — 20 was too low for normal usage (login + background syncs)
    standardHeaders: true,
    legacyHeaders: false,
    validate: false,
    message: { error: 'Too many synchronization requests. Please throttle scraper triggers.' }
});
app.use('/api/auth/login', syncLimiter);
app.use('/api/sync', syncLimiter);



// ─── Standard Response Middleware ─────────────────────────────────────────────
app.use(responseStandardizer);


// (Health probes, metrics, and circuit breaker routes are registered above the rate limiter)

// ─── Application Routes ───────────────────────────────────────────────────────
const authRoutes        = require('./routes/auth');
const profileRoutes     = require('./routes/profile');
const marksRoutes       = require('./routes/marks');
const attendanceRoutes  = require('./routes/attendance');
const feesRoutes        = require('./routes/fees');
const assignmentsRoutes = require('./routes/assignments');
const timetableRoutes   = require('./routes/timetable');
const syllabusRoutes    = require('./routes/syllabus');
const syncRoutes        = require('./routes/sync');
const studentRoutes     = require('./routes/student');
const notificationsRoutes = require('./routes/notifications');
const examsRoutes       = require('./routes/exams');
const lmsRoutes         = require('./routes/lms');

const socketService = require('./services/socketService');
const syncQueue     = require('./services/syncQueue');
const maintenanceMiddleware = require('./middleware/maintenance');

// Auth routes are exempt from maintenance mode — students must always be able to log in
// even if the admin places the system in maintenance mode.
app.use('/api', (req, res, next) => {
    if (req.path.startsWith('/auth')) {
        return next(); // Skip maintenance check for auth
    }
    return maintenanceMiddleware(req, res, next);
});

app.use('/api/auth',          authRoutes);
app.use('/api/profile',       profileRoutes);
app.use('/api/marks',         marksRoutes);
app.use('/api/attendance',    attendanceRoutes);
app.use('/api/fees',          feesRoutes);
app.use('/api/assignments',   assignmentsRoutes);
app.use('/api/timetable',     timetableRoutes);
app.use('/api/syllabus',      syllabusRoutes);
app.use('/api/sync',          syncRoutes);
app.use('/api/student',       studentRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/exams',         examsRoutes);
app.use('/api/lms',           lmsRoutes);

// ─── Admin Portal Routes ──────────────────────────────────────────────────────
const adminRoutes = require('./routes/admin/index');
const demoRoutes  = require('./routes/demo');

app.use('/api/admin', adminRoutes);
app.use('/api/demo',  demoRoutes);

// ─── New Student-Facing Routes (V1.0 Features) ───────────────────────────────
const announcementsRoutes = require('./routes/announcements');
const placementsRoutes    = require('./routes/placements');
const feeNoticesRoutes    = require('./routes/feeNotices');
const exitPassesRoutes    = require('./routes/exitPasses');
const surveysRoutes       = require('./routes/surveys');
const helpDeskRoutes      = require('./routes/helpDesk');
const lostFoundRoutes     = require('./routes/lostFound');

app.use('/api/announcements', announcementsRoutes);
app.use('/api/placements',    placementsRoutes);
app.use('/api/fee-notices',   feeNoticesRoutes);
app.use('/api/exit-passes',   exitPassesRoutes);
app.use('/api/surveys',       surveysRoutes);
app.use('/api/help-desk',     helpDeskRoutes);
app.use('/api/lost-found',    lostFoundRoutes);

// ─── Error Handling ───────────────────────────────────────────────────────────
app.use(errorHandler);

// ─── Database Initialization ──────────────────────────────────────────────────
try {
    const { execSync } = require('child_process');
    logger.info('[DB-Init] Automatically syncing database schema with Prisma...');
    execSync('npx prisma db push --accept-data-loss --skip-generate', {
        cwd: __dirname,
        stdio: 'inherit',
        env: { ...process.env }
    });
    logger.info('[DB-Init] Database schema sync successful.');

    logger.info('[DB-Init] Seeding default administrative accounts...');
    execSync('node scripts/seed-admin.js', {
        cwd: __dirname,
        stdio: 'inherit',
        env: { ...process.env }
    });
    logger.info('[DB-Init] Database seeding successful.');
} catch (err) {
    logger.error(`[DB-Init] Database initialization/seeding failed: ${err.message}`);
}

// ─── Startup Puppeteer Validation ────────────────────────────────────────────
// Returns true if Chromium launched successfully, false if unavailable.
// IMPORTANT: Never calls process.exit() — the API must stay alive even if
// Chromium is missing so that Railway health checks pass and the container
// does not enter an infinite restart loop.
async function validateChromiumStartup() {
    const fs = require('fs');
    const puppeteer = require('puppeteer');
    const browserPool = require('./services/browserPool');

    const executablePath = browserPool.findChromiumExecutable();
    const resolvedPath = executablePath || 'default (cached)';

    logger.info(`[Puppeteer] Browser path discovered: ${resolvedPath}`);
    console.log(`[Puppeteer] Browser path discovered: ${resolvedPath}`);
    logger.info(`[Puppeteer] Browser detected at: ${resolvedPath}`);
    console.log(`[Puppeteer] Browser detected at: ${resolvedPath}`);

    // If an explicit path is set but doesn't exist on disk, log and abort
    // gracefully — do NOT crash the process.
    if (executablePath && !fs.existsSync(executablePath)) {
        logger.error(`[Puppeteer] Chromium executable missing at: ${executablePath}`);
        console.error(`[Puppeteer] Chromium executable missing at: ${executablePath}`);
        logger.warn('[Puppeteer] Scraping features will be disabled. API continues in read-only mode.');
        return false;
    }

    try {
        logger.info('[Puppeteer] Launching test browser instance...');
        const browser = await puppeteer.launch({
            headless: true,                          // 'new' was removed in Puppeteer v22+
            executablePath: executablePath || undefined,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu'
            ]
        });
        await browser.close();
        logger.info('[Puppeteer] Browser launch successful');
        console.log('[Puppeteer] Browser launch successful');
        logger.info('[Puppeteer] Launch test successful');
        console.log('[Puppeteer] Launch test successful');
        return true;
    } catch (err) {
        logger.error(`[Puppeteer] Launch test failed: ${err.message}`);
        console.error(`[Puppeteer] Launch test failed: ${err.message}`);
        logger.warn('[Puppeteer] Scraping features will be disabled. API continues in read-only mode.');
        return false;
    }
}

// ─── Server Startup ───────────────────────────────────────────────────────────
const server = app.listen(PORT, '0.0.0.0', async () => {
    logger.info(`[Server] SITAM Smart ERP Backend running on port ${PORT}`);
    console.log(`[Server] SITAM Smart ERP Backend running on port ${PORT}`);

    // Reset stuck sync locks on boot
    try {
        await prisma.student.updateMany({
            data: { isSyncing: false }
        });
        logger.info('[Startup] Successfully reset all stuck student isSyncing states.');
    } catch (lockErr) {
        logger.warn(`[Startup] Failed to reset isSyncing states: ${lockErr.message}`);
    }

    // Validate Chromium — degraded mode if unavailable (no crash-loop)
    const browserReady = await validateChromiumStartup();

    // Initialize browser pool only if Chromium is available
    if (browserReady) {
        const browserPool = require('./services/browserPool');
        browserPool.init().catch(err => logger.error(`[Server] BrowserPool pre-warm failed: ${err.message}`));
    } else {
        logger.warn('[Server] BrowserPool skipped — Chromium unavailable. Scraping endpoints will return 503.');
    }

    // Start WebSockets and background sync scheduler
    socketService.init(server);
    syncQueue.start();

    // Start inline queue worker if Redis is alive
    if (redisService.isAlive()) {
        try {
            const { startInlineWorker } = require('./services/inlineWorker');
            startInlineWorker();
        } catch (err) {
            logger.error(`[Server] Failed to start inline worker: ${err.message}`);
        }
    }

    // Update WebSocket metrics on connect/disconnect
    socketService.wss && socketService.wss.on('connection', () => {
        metricsService.increment('websocket_connections_opened_total');
        metricsService.adjustGauge('websocket_connections_active', 1);
    });

    // ── Observability Runtime ───────────────────────────────────────────────
    // Start all observability intervals (SLO, Synthetic, Business Metrics).
    // Must be called AFTER Redis is connected so BusinessMetricsCollector can
    // access HyperLogLog keys and SyntheticMonitor can probe queue health.
    if (process.env.DISABLE_SCHEDULERS !== 'true') {
        observabilityScheduler.start();
        sreScheduler.start();
        devSecOpsScheduler.start();
        feeReminderScheduler.start();
    } else {
        logger.info('[Server] Background schedulers are disabled (DISABLE_SCHEDULERS=true).');
    }


    // ── Security Posture → Deployment Gate Cross-Wire ───────────────────────
    // After both schedulers are up, inject the live SecurityReportAggregator
    // into DeploymentGovernor so deployment safety checks include the security
    // posture score from the DevSecOps pipeline.
    // Call graph: SecurityReportAggregator.aggregate() → aggregated-security-report.json
    //             → DeploymentGovernor.checkDeploymentSafety() → getLatestReport()
    //             → deployment_security_risk_penalty gauge
    if (sreScheduler.deploymentGovernor && devSecOpsScheduler.reportAggregator) {
        sreScheduler.deploymentGovernor.securityReportAggregator = devSecOpsScheduler.reportAggregator;
        logger.info('[Server] Security posture cross-wire: DeploymentGovernor ← SecurityReportAggregator');
    }

});

// ─── Graceful Shutdown ────────────────────────────────────────────────────────
const gracefulShutdown = async (signal) => {
    logger.info(`[Server] Received ${signal}. Initiating graceful shutdown...`);

    server.close(async () => {
        logger.info('[Server] HTTP server closed.');

        try {
            // Stop SRE control plane and observability intervals before tearing down infrastructure
            sreScheduler.stop();
            devSecOpsScheduler.stop();
            observabilityScheduler.stop();
            feeReminderScheduler.stop();


            const browserPool = require('./services/browserPool');
            await browserPool.shutdown();
            logger.info('[Server] BrowserPool shut down.');

            syncQueue.shutdown();
            logger.info('[Server] SyncQueue stopped.');

            await prisma.$disconnect();
            logger.info('[Server] PostgreSQL pool disconnected.');

            await redisService.disconnect();
            logger.info('[Server] Redis pool disconnected.');

            logger.info('[Server] Graceful shutdown complete. ✓');
            process.exit(0);
        } catch (err) {
            logger.error(`[Server] Shutdown error: ${err.message}`);
            process.exit(1);
        }
    });

    // Force-kill safety timeout
    setTimeout(() => {
        logger.error('[Server] Graceful shutdown timeout. Force killing.');
        process.exit(1);
    }, 15000);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT',  () => gracefulShutdown('SIGINT'));
process.on('unhandledRejection', (reason) => {
    logger.error(`[Server] Unhandled Rejection: ${reason}`);
});
process.on('uncaughtException', (err) => {
    logger.error(`[Server] Uncaught Exception: ${err.message}`, { stack: err.stack });
    process.exit(1);
});
