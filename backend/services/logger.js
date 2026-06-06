/**
 * SITAM Smart ERP — Centralized Logging Service
 *
 * Implements a production-grade Winston structured logging layer with:
 *   - Custom levels: fatal, error, warn, info, debug, trace
 *   - AsyncLocalStorage for async-safe request context propagation (requestId, traceId, correlationId)
 *   - Automatic redaction of sensitive data (passwords, tokens, cookies, secrets)
 *   - Winston Daily Rotate File transport with zipped archival and log retention policies
 *   - Standardized format compatible with Grafana Loki and Promtail
 */

const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const path = require('path');
const { AsyncLocalStorage } = require('async_hooks');
const { trace } = require('@opentelemetry/api');

const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const SERVICE_NAME = process.env.SERVICE_NAME || 'sitam-backend';

// ─── AsyncLocalStorage Log Context ──────────────────────────────────────────
const logContext = new AsyncLocalStorage();

/**
 * Executes a callback within a logging context, propagating trace details.
 */
function runWithContext(context, callback) {
    // Ensure traceId and correlationId default to requestId if missing
    const ctx = {
        requestId: context.requestId,
        traceId: context.traceId || context.requestId,
        correlationId: context.correlationId || context.requestId,
        ...context
    };
    return logContext.run(ctx, callback);
}

/**
 * Retrieves the current request logging context.
 */
function getContext() {
    return logContext.getStore() || {};
}

/**
 * Dynamically updates the active logging context.
 */
function updateContext(update) {
    const store = logContext.getStore();
    if (store) {
        Object.assign(store, update);
    }
}

// ─── Custom Log Levels and Colors ───────────────────────────────────────────
const customLevels = {
    levels: {
        fatal: 0,
        error: 1,
        warn: 2,
        info: 3,
        debug: 4,
        trace: 5
    },
    colors: {
        fatal: 'red bold',
        error: 'red',
        warn: 'yellow',
        info: 'green',
        debug: 'blue',
        trace: 'gray'
    }
};

winston.addColors(customLevels.colors);

// ─── Sensitive Data Redaction ───────────────────────────────────────────────
const REDACT_KEYS = [
    'password',
    'passwordconfirm',
    'token',
    'jwt',
    'cookie',
    'session',
    'sessionid',
    'authorization',
    'secret',
    'apikey',
    'db_password',
    'db_url'
];

/**
 * Recursively redacts sensitive keys in metadata objects.
 */
function redactObject(obj) {
    if (!obj || typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) {
        return obj.map(redactObject);
    }
    const copy = {};
    for (const [key, value] of Object.entries(obj)) {
        const keyLower = key.toLowerCase();
        if (REDACT_KEYS.includes(keyLower)) {
            copy[key] = '[REDACTED]';
        } else if (typeof value === 'object') {
            copy[key] = redactObject(value);
        } else if (typeof value === 'string') {
            const valLower = value.toLowerCase();
            if (keyLower === 'authorization' || valLower.includes('bearer ')) {
                copy[key] = '[REDACTED]';
            } else {
                copy[key] = redactString(value);
            }
        } else {
            copy[key] = value;
        }
    }
    return copy;
}

/**
 * Regular expression based redaction for log messages.
 */
function redactString(str) {
    if (typeof str !== 'string') return str;
    return str
        .replace(/(password=["']?)([^"'\s&]+)(["']?)/gi, '$1[REDACTED]$3')
        .replace(/(authorization:\s*bearer\s+)([^"'\s&]+)/gi, '$1[REDACTED]')
        .replace(/(bearer\s+)([^"'\s&]+)/gi, '$1[REDACTED]')
        .replace(/(token=["']?)([^"'\s&]+)(["']?)/gi, '$1[REDACTED]$3');
}

const redactFormat = winston.format((info) => {
    if (info.message) {
        info.message = redactString(info.message);
    }
    for (const key of Object.keys(info)) {
        if (key !== 'message' && key !== 'level' && key !== 'timestamp') {
            if (typeof info[key] === 'object') {
                info[key] = redactObject(info[key]);
            } else if (typeof info[key] === 'string') {
                if (REDACT_KEYS.includes(key.toLowerCase())) {
                    info[key] = '[REDACTED]';
                } else {
                    info[key] = redactString(info[key]);
                }
            }
        }
    }
    return info;
})();

// ─── Async Context Injector Format ──────────────────────────────────────────
const contextInjectorFormat = winston.format((info) => {
    try {
        const activeSpan = trace.getActiveSpan();
        if (activeSpan) {
            const spanContext = activeSpan.spanContext();
            if (spanContext && spanContext.traceId) {
                info.traceId = spanContext.traceId;
                info.spanId = spanContext.spanId;
            }
        }
    } catch (_) {}

    const store = logContext.getStore();
    if (store) {
        Object.assign(info, {
            ...store,
            ...info // Prioritize explicit info details
        });
    }
    info.service = info.service || SERVICE_NAME;
    info.environment = info.environment || process.env.NODE_ENV || 'production';
    return info;
})();

// ─── Format Formulations ───────────────────────────────────────────────────
const jsonFormat = winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
    contextInjectorFormat,
    redactFormat,
    winston.format.errors({ stack: true }),
    winston.format.json()
);

const consoleFormat = winston.format.combine(
    winston.format.colorize(),
    winston.format.timestamp({ format: 'HH:mm:ss.SSS' }),
    contextInjectorFormat,
    redactFormat,
    winston.format.printf(({ timestamp, level, message, requestId, userId, jobId, workerId, durationMs, stack, ...rest }) => {
        let line = `[${timestamp}] ${level}: ${message}`;
        const ctx = [
            requestId ? `reqId=${requestId}` : null,
            userId ? `user=${userId}` : null,
            jobId ? `job=${jobId}` : null,
            workerId ? `worker=${workerId}` : null,
            durationMs !== undefined ? `${durationMs}ms` : null,
        ].filter(Boolean).join(' | ');
        if (ctx) line += `  {${ctx}}`;
        if (stack) line += `\n${stack}`;
        return line;
    })
);

// ─── Transports Configuration (Daily Rotation & Archival) ───────────────────
const logsDir = path.join(__dirname, '../logs');

const transports = [
    new DailyRotateFile({
        filename: path.join(logsDir, 'error-%DATE%.log'),
        datePattern: 'YYYY-MM-DD',
        zippedArchive: true,
        maxSize: '10m',
        maxFiles: '14d',
        level: 'error',
        format: jsonFormat,
    }),
    new DailyRotateFile({
        filename: path.join(logsDir, 'combined-%DATE%.log'),
        datePattern: 'YYYY-MM-DD',
        zippedArchive: true,
        maxSize: '20m',
        maxFiles: '14d',
        format: jsonFormat,
    }),
    new winston.transports.Console({
        format: IS_PRODUCTION ? jsonFormat : consoleFormat,
    })
];

// ─── Logger Instantiation ───────────────────────────────────────────────────
const logger = winston.createLogger({
    levels: customLevels.levels,
    level: IS_PRODUCTION ? 'info' : 'debug',
    format: jsonFormat,
    transports,
    exceptionHandlers: [
        new DailyRotateFile({
            filename: path.join(logsDir, 'exceptions-%DATE%.log'),
            datePattern: 'YYYY-MM-DD',
            zippedArchive: true,
            maxSize: '10m',
            maxFiles: '14d',
            format: jsonFormat,
        })
    ],
    rejectionHandlers: [
        new DailyRotateFile({
            filename: path.join(logsDir, 'rejections-%DATE%.log'),
            datePattern: 'YYYY-MM-DD',
            zippedArchive: true,
            maxSize: '10m',
            maxFiles: '14d',
            format: jsonFormat,
        })
    ],
});

// Polyfill trace/fatal if not standard on winston logger interface
if (!logger.trace) logger.trace = (...args) => logger.log('trace', ...args);
if (!logger.fatal) logger.fatal = (...args) => logger.log('fatal', ...args);

module.exports = Object.assign(logger, {
    logger,
    runWithContext,
    getContext,
    updateContext,
    logContext
});
