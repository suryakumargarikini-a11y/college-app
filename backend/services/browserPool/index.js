'use strict';

/**
 * BrowserPool — Public API (Drop-in Replacement)
 *
 * Creates and wires together the dual-pool architecture:
 *
 *   AUTH_POOL  (AUTH_POOL_SIZE, default 2)
 *     • ERP login + Profile + Attendance + Fees (hybrid synchronous data)
 *     • Fixed size — never auto-scales (auth browsers are precious)
 *     • Pre-warmed at startup
 *
 *   SYNC_POOL  (SYNC_POOL_SIZE, default 4)
 *     • Marks, Assignments, Timetable, Notifications — background scraping
 *     • Auto-scales up to SYNC_POOL_SIZE based on queue pressure
 *     • Pre-warmed at startup
 *
 * Environment variables:
 *   AUTH_POOL_SIZE             = 2     (max AUTH_POOL browsers)
 *   SYNC_POOL_SIZE             = 4     (max SYNC_POOL browsers, alias BROWSER_POOL_SIZE)
 *   BROWSER_ACQUIRE_TIMEOUT_MS = 60000 (max wait for a browser slot)
 *   BROWSER_IDLE_RECYCLE_MS    = 1800000 (30 min idle → recycle)
 *   BROWSER_MAX_JOBS           = 100   (jobs before forced recycle)
 *   BROWSER_MAX_LIFETIME_MS    = 1800000 (30 min uptime → forced recycle)
 *   SESSION_AFFINITY_TTL_MS    = 600000 (10 min session affinity window)
 *   PUPPETEER_SINGLE_PROCESS   = true  (add --single-process flag for memory-limited envs)
 *
 * Backward-compatible API (no changes needed in puppeteerService.js or worker.js):
 *   browserPool.acquire(requestId)                     → SYNC_POOL, BACKGROUND priority
 *   browserPool.release(browserId, ctx, reqId, error)  → SYNC_POOL release
 *   browserPool.init()
 *   browserPool.shutdown()
 *   browserPool.getStatus()
 *   browserPool.findChromiumExecutable()
 *
 * New high-level API:
 *   browserPool.scheduler.runAuthJob(requestId, fn, opts)
 *   browserPool.scheduler.runSyncJob(jobType, requestId, fn, opts)
 *   browserPool.scheduler.isErpAvailable()
 *   browserPool.authPool
 *   browserPool.syncPool
 *
 * @module browserPool/index
 */

const logger = require('../logger');
const BrowserPool  = require('./BrowserPool');
const JobScheduler = require('./JobScheduler');
const { JOB_PRIORITY } = require('./PriorityQueue');
const { findChromiumExecutable } = require('./chromiumFinder');

// ─── Configuration ────────────────────────────────────────────────────────────

const AUTH_POOL_SIZE = parseInt(process.env.AUTH_POOL_SIZE || '2', 10);
const SYNC_POOL_SIZE = parseInt(
    process.env.SYNC_POOL_SIZE || process.env.BROWSER_POOL_SIZE || '4',
    10
);

/**
 * Chromium launch flags — tuned for Render's container environment.
 * Disables GPU, sandbox, and background processes to minimise memory footprint.
 */
const LAUNCH_ARGS = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--memory-pressure-off',
    '--no-zygote',
    '--disable-extensions',
    '--no-first-run',
    '--disable-background-networking',
    '--disable-features=SitePerProcess',
    '--disable-software-rasterizer',
];

if (process.env.PUPPETEER_SINGLE_PROCESS === 'true') {
    LAUNCH_ARGS.push('--single-process');
}

// ─── Pool Instantiation ───────────────────────────────────────────────────────

const authPool = new BrowserPool({
    name:        'AUTH_POOL',
    minBrowsers: Math.min(AUTH_POOL_SIZE, 2),   // pre-warm up to 2 auth browsers
    maxBrowsers: AUTH_POOL_SIZE,
    autoScale:   false,                          // AUTH_POOL is fixed — no auto-scale
    launchArgs:  LAUNCH_ARGS,
});

const syncPool = new BrowserPool({
    name:        'SYNC_POOL',
    minBrowsers: Math.min(SYNC_POOL_SIZE, 2),   // pre-warm 2 sync browsers minimum
    maxBrowsers: SYNC_POOL_SIZE,
    autoScale:   true,                           // SYNC_POOL scales dynamically
    launchArgs:  LAUNCH_ARGS,
});

const scheduler = new JobScheduler({ authPool, syncPool });

// ─── Public API Object ────────────────────────────────────────────────────────

const browserPoolAPI = {
    // ── Pool references (advanced usage / tests) ──────────────────────────
    authPool,
    syncPool,
    scheduler,

    /** @see chromiumFinder.js — kept on the public API for server.js compatibility */
    findChromiumExecutable,

    // ── Lifecycle ─────────────────────────────────────────────────────────

    /**
     * Initialize both pools — pre-warms all minimum browsers in parallel.
     * Must be called once on server startup after Chromium is validated.
     */
    async init() {
        logger.info(
            `[POOL] Dual-pool startup: ` +
            `AUTH_POOL_SIZE=${AUTH_POOL_SIZE} SYNC_POOL_SIZE=${SYNC_POOL_SIZE}`
        );
        await Promise.all([authPool.init(), syncPool.init()]);
        logger.info('[POOL] Both pools ready. System is production-ready.');
    },

    /**
     * Graceful shutdown — drains queues, rejects waiters, closes all browsers.
     * Call this on SIGTERM / SIGINT.
     */
    async shutdown() {
        logger.info('[POOL] Shutting down all pools...');
        await Promise.allSettled([authPool.shutdown(), syncPool.shutdown()]);
        logger.info('[POOL] All pools shut down.');
    },

    // ── Backward-compatible acquire / release (routes to SYNC_POOL) ───────
    //
    // Existing callers (puppeteerService.js, worker.js) call:
    //   const { browserId, context } = await browserPool.acquire(requestId)
    //   await browserPool.release(browserId, context, requestId, error)
    //
    // These route to SYNC_POOL at BACKGROUND_SYNC priority so they work
    // identically to before — no changes needed in any caller.

    /**
     * @param {string} [requestId]
     * @returns {Promise<{ browserId: string, context: BrowserContext, _checkedOutAt: number }>}
     */
    async acquire(requestId = 'unknown') {
        return syncPool.acquire({
            priority:  JOB_PRIORITY.BACKGROUND_SYNC,
            requestId,
            jobType:   'BACKGROUND_SYNC',
            userId:    undefined,
        });
    },

    /**
     * @param {string}  browserId
     * @param {BrowserContext} context
     * @param {string}  [requestId]
     * @param {Error|null} [error]
     */
    async release(browserId, context, requestId = 'unknown', error = null) {
        await syncPool.release(browserId, context, requestId, error, Date.now());
    },

    // ── Status & diagnostics ──────────────────────────────────────────────

    /**
     * Returns combined status from both pools.
     * Used by /api/health/readiness, /api/browserpool, and /api/metrics.
     */
    getStatus() {
        const auth = authPool.getStatus();
        const sync = syncPool.getStatus();
        return {
            // Flatten for backward compat with server.js /api/metrics gauge reads
            total:   auth.total + sync.total,
            active:  auth.active + sync.active,
            idle:    auth.idle + sync.idle,
            queued:  auth.queued + sync.queued,
            // New structured view
            authPool: auth,
            syncPool: sync,
        };
    },
};

module.exports = browserPoolAPI;
