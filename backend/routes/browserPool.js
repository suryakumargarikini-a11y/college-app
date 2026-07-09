'use strict';

/**
 * BrowserPool Metrics Route
 *
 * GET /api/browserpool
 *
 * Returns real-time operational metrics for both browser pools.
 * Secured via the existing operator auth middleware.
 *
 * Response shape:
 * {
 *   "timestamp": "ISO string",
 *   "authPool": {
 *     "name": "AUTH_POOL",
 *     "total": 2, "active": 1, "idle": 1, "queued": 0,
 *     "currentCap": 2, "maxBrowsers": 2,
 *     "browsers": [ { id, inUse, jobCount, uptimeSec, ... } ],
 *     "metrics": { avgWaitMs, avgJobDurationMs, peakQueueDepth, ... },
 *     "system": { nodeRssMb, sysFreePercent }
 *   },
 *   "syncPool": { ... same shape ... },
 *   "scheduler": { isErpAvailable: true|false },
 *   "combined": {
 *     "totalBrowsers": 6,
 *     "activeBrowsers": 2,
 *     "idleBrowsers": 4,
 *     "totalQueued": 0
 *   }
 * }
 */

const express = require('express');
const router = express.Router();
const logger = require('../services/logger');

/**
 * Lazy-load browserPool to avoid circular dep issues at module load.
 * (browserPool requires logger, logger may be required before browserPool.init())
 */
function getPool() {
    return require('../services/browserPool');
}

/**
 * GET /api/browserpool
 * Full pool status including per-browser diagnostics and EMA metrics.
 */
router.get('/', (req, res) => {
    try {
        const pool = getPool();
        const status = pool.getStatus();
        const erpAvailable = pool.scheduler.isErpAvailable();

        const response = {
            timestamp: new Date().toISOString(),
            authPool:  status.authPool,
            syncPool:  status.syncPool,
            scheduler: {
                isErpAvailable: erpAvailable.allowed,
                erpNote:        erpAvailable.reason || null,
            },
            combined: {
                totalBrowsers:  status.total,
                activeBrowsers: status.active,
                idleBrowsers:   status.idle,
                totalQueued:    status.queued,
            },
        };

        res.json({ status: 'ok', data: response });
    } catch (err) {
        logger.error(`[BrowserPool-Route] Status fetch error: ${err.message}`);
        res.status(500).json({ status: 'error', message: err.message });
    }
});

/**
 * GET /api/browserpool/health
 * Lightweight health check (no per-browser diagnostics) — suitable for uptime monitors.
 */
router.get('/health', (req, res) => {
    try {
        const pool = getPool();
        const status = pool.getStatus();

        const auth = status.authPool;
        const sync = status.syncPool;

        const healthy =
            (auth.total > 0 || auth.queued === 0) &&
            (sync.total > 0 || sync.queued === 0);

        res.status(healthy ? 200 : 503).json({
            status:  healthy ? 'healthy' : 'degraded',
            authPool: { total: auth.total, active: auth.active, queued: auth.queued },
            syncPool: { total: sync.total, active: sync.active, queued: sync.queued },
        });
    } catch (err) {
        res.status(500).json({ status: 'error', message: err.message });
    }
});

/**
 * POST /api/browserpool/drain
 * Operator action: gracefully drain and reinitialize both pools.
 * Useful after a rash of crashes or suspected memory leak.
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
