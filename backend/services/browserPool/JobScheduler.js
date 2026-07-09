'use strict';

/**
 * JobScheduler — Routes Puppeteer Jobs to the Correct Pool
 *
 * This is the primary entry point for all Puppeteer work in the application.
 * It abstracts pool selection and enforces per-module timeouts so that:
 *
 *   • Login jobs always run in AUTH_POOL (never starved by scraping)
 *   • Every module has its own timeout — one failure never cancels others
 *   • Circuit breaker integration — if ERP is down, jobs fail fast
 *     instead of consuming a browser slot for 30+ seconds
 *
 * ─── Hybrid Login Flow ───────────────────────────────────────────────────────
 *
 *   runAuthJob()     → AUTH_POOL (Login priority=1)
 *                      ERP login + Profile + Attendance + Fees
 *                      Returns synchronously to the HTTP response
 *
 *   runSyncJob()     → SYNC_POOL (priority depends on jobType)
 *                      Marks, Assignments, Timetable, Notifications, etc.
 *                      Runs in the background after JWT is returned
 *
 * ─── Per-Module Timeouts ─────────────────────────────────────────────────────
 *
 *   LOGIN / AUTH     30 s
 *   MANUAL_REFRESH   45 s
 *   ATTENDANCE       20 s
 *   FEES             20 s
 *   MARKS            30 s
 *   ASSIGNMENTS      30 s
 *   TIMETABLE        20 s
 *   NOTIFICATIONS    20 s
 *   BACKGROUND_SYNC  60 s
 *
 * @module JobScheduler
 */

const logger = require('../logger');
const { JOB_PRIORITY } = require('./PriorityQueue');

/** Per-module timeout overrides (ms). Falls back to BACKGROUND_SYNC if not listed. */
const MODULE_TIMEOUTS = {
    LOGIN:           30_000,
    MANUAL_REFRESH:  45_000,
    ATTENDANCE:      20_000,
    FEES:            20_000,
    MARKS:           30_000,
    ASSIGNMENTS:     30_000,
    TIMETABLE:       20_000,
    NOTIFICATIONS:   20_000,
    BACKGROUND_SYNC: 60_000,
};

class JobScheduler {
    /**
     * @param {Object} opts
     * @param {import('./BrowserPool')} opts.authPool - AUTH_POOL instance
     * @param {import('./BrowserPool')} opts.syncPool - SYNC_POOL instance
     */
    constructor({ authPool, syncPool }) {
        this.authPool = authPool;
        this.syncPool = syncPool;
    }

    // ─── Public API ───────────────────────────────────────────────────────────

    /**
     * Run an ERP login/authentication job in the AUTH_POOL.
     *
     * The function receives a fresh incognito BrowserContext.
     * It should return the critical dashboard data (Profile, Attendance, Fees)
     * that will be sent synchronously with the JWT response.
     *
     * @param {string}   requestId - Correlation ID
     * @param {Function} fn        - async (context: BrowserContext) => any
     * @param {Object}   [opts]
     * @param {string}   [opts.userId] - Student ID (enables session affinity)
     * @returns {Promise<any>} Result of fn()
     */
    async runAuthJob(requestId, fn, opts = {}) {
        return this._run(this.authPool, {
            priority: JOB_PRIORITY.LOGIN,
            jobType:  'LOGIN',
            requestId,
            userId:   opts.userId,
            fn,
        });
    }

    /**
     * Run a background scraping job in the SYNC_POOL.
     *
     * Each module (Marks, Assignments, Timetable, etc.) runs as an independent
     * job — one module's timeout never affects another.
     *
     * @param {string}   jobType   - Key from JOB_PRIORITY (e.g. 'MARKS', 'ATTENDANCE')
     * @param {string}   requestId - Correlation ID
     * @param {Function} fn        - async (context: BrowserContext) => any
     * @param {Object}   [opts]
     * @param {string}   [opts.userId] - Student ID (enables session affinity)
     * @returns {Promise<any>} Result of fn()
     */
    async runSyncJob(jobType, requestId, fn, opts = {}) {
        const priority = JOB_PRIORITY[jobType] ?? JOB_PRIORITY.BACKGROUND_SYNC;
        return this._run(this.syncPool, {
            priority,
            jobType,
            requestId,
            userId: opts.userId,
            fn,
        });
    }

    /**
     * Check if the circuit breaker allows ERP requests.
     * Use this before queuing a browser job to avoid wasting a browser slot
     * when the ERP website is known to be unreachable.
     *
     * @returns {{ allowed: boolean, reason?: string }}
     */
    isErpAvailable() {
        try {
            const cb = require('../circuitBreaker');
            const state = cb.getStatus();
            if (state.state === 'OPEN') {
                return {
                    allowed: false,
                    reason:  `ERP circuit breaker OPEN — retrying in ${state.cooldownRemainingMs}ms`,
                };
            }
            return { allowed: true };
        } catch (_) {
            return { allowed: true }; // fail open if circuitBreaker is unavailable
        }
    }

    /**
     * Returns combined status from both pools for the metrics endpoint.
     */
    getStatus() {
        return {
            authPool: this.authPool.getStatus(),
            syncPool: this.syncPool.getStatus(),
        };
    }

    // ─── Internal ─────────────────────────────────────────────────────────────

    /**
     * Core execution wrapper:
     *   1. Acquire browser slot from the target pool (with priority)
     *   2. Race fn() against a per-module timeout
     *   3. Release the slot regardless of outcome
     *
     * @param {import('./BrowserPool')} pool
     * @param {Object} opts
     */
    async _run(pool, { priority, jobType, requestId, userId, fn }) {
        const timeoutMs = MODULE_TIMEOUTS[jobType] || MODULE_TIMEOUTS.BACKGROUND_SYNC;

        logger.info(
            `[POOL][Scheduler] Job Queued: ` +
            `type=${jobType} pool=${pool.name} req=${requestId} timeout=${timeoutMs}ms`
        );

        // Acquire a browser slot (blocks until one is free or timeout)
        const slot = await pool.acquire({ priority, requestId, jobType, userId });
        const { browserId, context, _checkedOutAt } = slot;

        let error = null;
        let result = null;

        try {
            // Race the user's function against the module-specific timeout
            result = await Promise.race([
                fn(context),
                new Promise((_, reject) =>
                    setTimeout(
                        () => reject(
                            new Error(
                                `[Scheduler] ${jobType} timed out after ${timeoutMs}ms ` +
                                `(req=${requestId})`
                            )
                        ),
                        timeoutMs
                    )
                ),
            ]);
            logger.info(
                `[POOL][Scheduler] Job Finished: type=${jobType} req=${requestId}`
            );
        } catch (err) {
            error = err;
            logger.error(
                `[POOL][Scheduler] Job Error: ` +
                `type=${jobType} req=${requestId} err=${err.message}`
            );
        } finally {
            // ALWAYS release the slot — even on error, even on timeout
            await pool.release(browserId, context, requestId, error, _checkedOutAt);
        }

        if (error) throw error;
        return result;
    }
}

module.exports = JobScheduler;
