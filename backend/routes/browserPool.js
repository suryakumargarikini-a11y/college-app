'use strict';

/**
 * BrowserPool Metrics & Health Route
 *
 * GET /api/browserpool
 *   Full operational status including per-browser diagnostics, EMA metrics,
 *   session isolation stats, active captures, and provider information.
 *
 * GET /api/browserpool/health
 *   Lightweight health check for uptime monitors.
 *   Returns HTTP 200 (healthy) or 503 (degraded).
 *
 * GET /api/browserpool/browsers
 *   Per-browser detail for each instance in both pools, including:
 *     provider, pid, browserVersion, status, inUse, jobCount, crashCount,
 *     launchTimeMs, uptimeSec, idleSec, lastUsed, browserMemoryMb
 *
 * POST /api/browserpool/drain
 *   Operator action: graceful pool drain + reinitialize.
 *
 * Example full response shape (GET /api/browserpool):
 * {
 *   "timestamp": "ISO",
 *   "provider": "PUPPETEER",
 *   "isolation": { "totalChecks": 0, "totalViolations": 0, "cleanRate": "100.0%" },
 *   "debugCapture": { "enabled": false, "baseDir": "...", "retentionDays": 7 },
 *   "authPool": { ... BrowserPool.getStatus() ... },
 *   "syncPool": { ... BrowserPool.getStatus() ... },
 *   "scheduler": { "isErpAvailable": true, "erpNote": null },
 *   "combined": { "totalBrowsers": 6, "activeBrowsers": 2, ... },
 *   "system": {
 *     "nodeRssMb": 180,
 *     "nodeHeapUsedMb": 90,
 *     "sysFreePercent": 42,
 *     "uptimeSeconds": 3600
 *   }
 * }
 */

const express = require('express');
const os      = require('os');
const router  = express.Router();
const logger  = require('../services/logger');

function getPool() {
    return require('../services/browserPool');
}

function getIsolationStats() {
    try {
        return require('../services/browserPool/SessionIsolationValidator').getStats();
    } catch (_) {
        return null;
    }
}

function getDebugCaptureInfo() {
    try {
        const DebugCapture = require('../services/DebugCapture');
        return {
            enabled:       DebugCapture.isEnabled(),
            baseDir:       DebugCapture.getBaseDir(),
            retentionDays: parseInt(process.env.DEBUG_CAPTURE_RETENTION_DAYS || '7', 10),
        };
    } catch (_) {
        return null;
    }
}

/**
 * GET /api/browserpool
 * Full pool status — operational dashboard data.
 */
router.get('/', (req, res) => {
    try {
        const pool      = getPool();
        const status    = pool.getStatus();
        const erpAvail  = pool.scheduler.isErpAvailable();
        const mem       = process.memoryUsage();

        const response = {
            timestamp:    new Date().toISOString(),
            provider:     status.provider || 'unknown',
            isolation:    getIsolationStats(),
            debugCapture: getDebugCaptureInfo(),

            authPool: status.authPool,
            syncPool: status.syncPool,

            scheduler: {
                isErpAvailable: erpAvail.allowed,
                erpNote:        erpAvail.reason || null,
            },

            combined: {
                totalBrowsers:  status.total,
                activeBrowsers: status.active,
                idleBrowsers:   status.idle,
                totalQueued:    status.queued,
            },

            system: {
                nodeRssMb:      Math.round(mem.rss / 1024 / 1024),
                nodeHeapUsedMb: Math.round(mem.heapUsed / 1024 / 1024),
                sysFreePercent: Math.round((os.freemem() / os.totalmem()) * 100),
                uptimeSeconds:  Math.round(process.uptime()),
            },
        };

        res.json({ status: 'ok', data: response });
    } catch (err) {
        logger.error(`[BrowserPool-Route] Status fetch error: ${err.message}`);
        res.status(500).json({ status: 'error', message: err.message });
    }
});

/**
 * GET /api/browserpool/browsers
 * Per-browser instance detail — one entry per browser across both pools.
 * This is the operational dashboard view the user spec described:
 *
 * {
 *   "provider": "playwright",
 *   "browserVersion": "...",
 *   "browserPid": 12345,
 *   "status": "idle",
 *   "contexts": 0,           (tracked via PoolMetrics.contextsCreated - contextsDestroyed)
 *   "browserMemoryMb": 180,  (Linux only — null on Windows)
 *   "launchTimeMs": 1200,
 *   "lastUsed": "ISO",
 *   "crashCount": 0,
 *   "uptimeSec": 3600,
 *   "jobCount": 45,
 *   "poolName": "AUTH_POOL"
 * }
 */
router.get('/browsers', (req, res) => {
    try {
        const pool   = getPool();
        const status = pool.getStatus();

        const browsers = [
            ...(status.authPool ? status.authPool.browsers || [] : []),
            ...(status.syncPool ? status.syncPool.browsers || [] : []),
        ];

        // Add pool-level isolation leak count as context count approximation
        const authLeak = status.authPool && status.authPool.metrics
            ? (status.authPool.metrics.contexts.created - status.authPool.metrics.contexts.destroyed)
            : 0;
        const syncLeak = status.syncPool && status.syncPool.metrics
            ? (status.syncPool.metrics.contexts.created - status.syncPool.metrics.contexts.destroyed)
            : 0;

        res.json({
            status:      'ok',
            timestamp:   new Date().toISOString(),
            provider:    status.provider || 'unknown',
            totalBrowsers: browsers.length,
            activeSessions: status.active,
            queuedRequests: status.queued,
            liveContexts: {
                authPool: Math.max(0, authLeak),
                syncPool: Math.max(0, syncLeak),
            },
            browsers,
        });
    } catch (err) {
        logger.error(`[BrowserPool-Route] Browsers fetch error: ${err.message}`);
        res.status(500).json({ status: 'error', message: err.message });
    }
});

/**
 * GET /api/browserpool/health
 * Lightweight 200/503 health check for uptime monitors and load balancers.
 */
router.get('/health', (req, res) => {
    try {
        const pool   = getPool();
        const status = pool.getStatus();

        const auth = status.authPool;
        const sync = status.syncPool;

        const healthy =
            (auth.total > 0 || auth.queued === 0) &&
            (sync.total > 0 || sync.queued === 0);

        const isolation = getIsolationStats();
        const isolationClean = !isolation || isolation.totalViolations === 0;

        res.status(healthy ? 200 : 503).json({
            status:     healthy ? 'healthy' : 'degraded',
            provider:   status.provider || 'unknown',
            authPool:   { total: auth.total, active: auth.active, queued: auth.queued },
            syncPool:   { total: sync.total, active: sync.active, queued: sync.queued },
            isolation:  {
                clean:      isolationClean,
                violations: isolation ? isolation.totalViolations : 0,
            },
            uptimeSeconds: Math.round(process.uptime()),
        });
    } catch (err) {
        res.status(500).json({ status: 'error', message: err.message });
    }
});

/**
 * POST /api/browserpool/drain
 * Operator action: gracefully drain and reinitialize both pools.
 */
router.post('/drain', async (req, res) => {
    logger.info('[BrowserPool-Route] Operator triggered pool drain.');
    try {
        const pool = getPool();
        await pool.shutdown();
        await pool.init();
        const status = pool.getStatus();
        res.json({
            status:  'drained_and_reinit',
            message: 'Both pools shut down and re-initialized.',
            provider: status.provider || 'unknown',
            pools: {
                authPool: { total: status.authPool.total },
                syncPool: { total: status.syncPool.total },
            },
        });
    } catch (err) {
        logger.error(`[BrowserPool-Route] Drain failed: ${err.message}`);
        res.status(500).json({ status: 'error', message: err.message });
    }
});

module.exports = router;
