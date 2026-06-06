require('dotenv').config();
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

const app = express();
const PORT = process.env.PORT || 3001;

// ─── Initialize Infrastructure ────────────────────────────────────────────────
redisService.connect();
workerService.init();

// ─── Security Headers ─────────────────────────────────────────────────────────
app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false
}));

// ─── CORS ─────────────────────────────────────────────────────────────────────
const corsWhitelist = [
    'http://localhost:3000',
    'http://localhost:3001',
    'capacitor://localhost',
    'http://localhost',
    'https://sitamecap.co.in'
];
app.use(cors({
    origin: (origin, callback) => {
        if (!origin || corsWhitelist.includes(origin) || origin.startsWith('chrome-extension://')) {
            callback(null, true);
        } else {
            logger.warn(`[CORS] Blocked request from unauthorized origin: ${origin}`);
            callback(new Error('Blocked by CORS'));
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
const sreService = require('./services/sreService');
app.use(async (req, res, next) => {
    const userId = req.headers['x-student-id'] || (req.body && req.body.userId) || req.query.userId || req.headers['x-user-id'];
    if (userId) {
        req.tenantUserId = userId;
        const tenantQuota = await sreService.registerTenantRequest(userId);
        
        if (tenantQuota.isThrottled) {
            logger.warn(`[SRE-Tenancy] Throttling request for tenant: ${userId}`);
            res.setHeader('Retry-After', '5');
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        res.on('finish', async () => {
            await sreService.releaseTenantRequest(userId);
        });
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
        checks.database = { status: 'ready', provider: 'postgresql' };
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
    
    // Set Gauges
    metricsService.metrics.browserPoolActiveBrowsers.set(poolStatus.total);
    metricsService.metrics.browserPoolActiveContexts.set(poolStatus.active);
    metricsService.metrics.browserPoolTimeoutsTotal.inc(poolStatus.queued); // queued represents timeouts/wait depth
    
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

// ─── Rate Limiting (applied AFTER infra routes) ───────────────────────────────
const generalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests. Please try again after 15 minutes.' }
});
app.use('/api', generalLimiter);

const syncLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
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

const socketService = require('./services/socketService');
const syncQueue     = require('./services/syncQueue');

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

// ─── Error Handling ───────────────────────────────────────────────────────────
app.use(errorHandler);

// ─── Server Startup ───────────────────────────────────────────────────────────
const server = app.listen(PORT, async () => {
    logger.info(`[Server] SITAM Smart ERP Backend running on http://localhost:${PORT}`);
    console.log(`[Server] SITAM Smart ERP Backend running on http://localhost:${PORT}`);

    // Initialize browser pool (pre-warms 1 Chromium instance)
    const browserPool = require('./services/browserPool');
    browserPool.init().catch(err => logger.error(`[Server] BrowserPool pre-warm failed: ${err.message}`));

    // Start WebSockets and background sync scheduler
    socketService.init(server);
    syncQueue.start();

    // Update WebSocket metrics on connect/disconnect
    socketService.wss && socketService.wss.on('connection', () => {
        metricsService.increment('websocket_connections_opened_total');
        metricsService.adjustGauge('websocket_connections_active', 1);
    });
});

// ─── Graceful Shutdown ────────────────────────────────────────────────────────
const gracefulShutdown = async (signal) => {
    logger.info(`[Server] Received ${signal}. Initiating graceful shutdown...`);

    server.close(async () => {
        logger.info('[Server] HTTP server closed.');

        try {
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
