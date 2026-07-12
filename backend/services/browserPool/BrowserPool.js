'use strict';

/**
 * BrowserPool — Fleet Manager for Chromium Browser Instances
 *
 * Manages N BrowserInstance objects for one logical pool (AUTH_POOL or SYNC_POOL).
 *
 * Features:
 *   1. Priority queue (min-heap) — Login always served before background jobs
 *   2. Session affinity — same student → same browser → warm cookies
 *   3. Adaptive auto-scaling — grow on queue pressure, shrink when idle
 *   4. Browser lifetime recycling — max 100 jobs OR 30 min, whichever comes first
 *   5. Crash recovery — crashed browser replaced + queue resumed automatically
 *   6. Memory-safe scaling — never scale up when system memory is low
 *   7. Hysteresis on scale-down — waits 60s of idle before shrinking
 *
 * Configuration (via constructor config object, driven by env vars in index.js):
 *   name            : 'AUTH_POOL' | 'SYNC_POOL'
 *   minBrowsers     : Always-warm browser count (pre-warmed at init)
 *   maxBrowsers     : Hard cap (AUTH_POOL_SIZE or SYNC_POOL_SIZE)
 *   autoScale       : true = dynamic scaling (SYNC_POOL only), false = fixed (AUTH_POOL)
 *   launchArgs      : Chromium CLI flags
 *
 * @module BrowserPool
 */

const os = require('os');
const logger = require('../logger');
const BrowserInstance = require('./BrowserInstance');
const { PriorityQueue } = require('./PriorityQueue');
const PoolMetrics = require('./PoolMetrics');
const sessionAffinity = require('./SessionAffinityMap');
const queuePersistence = require('./QueuePersistence');
const { findChromiumExecutable } = require('./chromiumFinder');

const ACQUIRE_TIMEOUT_MS = parseInt(process.env.BROWSER_ACQUIRE_TIMEOUT_MS || '60000', 10);
const IDLE_RECYCLE_MS = parseInt(
    process.env.BROWSER_IDLE_RECYCLE_MS || String(30 * 60 * 1000),
    10
);

/** Minimum free system memory % required to auto-scale up */
const DEFAULT_MEM_SAFE_FREE_PERCENT = 30;
/** How often to check auto-scale conditions */
const SCALE_CHECK_INTERVAL_MS = 5_000;
/** How long idle must persist before scaling down (hysteresis) */
const SCALE_DOWN_HYSTERESIS_MS = 60_000;
/** Idle recycle check interval */
const RECYCLE_INTERVAL_MS = 2 * 60 * 1000;

class BrowserPool {
    /**
     * @param {Object} config
     * @param {string}   config.name         - Pool identifier ('AUTH_POOL' | 'SYNC_POOL')
     * @param {number}   config.minBrowsers  - Always-warm browser count
     * @param {number}   config.maxBrowsers  - Hard cap (never exceeded)
     * @param {boolean}  [config.autoScale]  - Enable dynamic sizing (default true)
     * @param {string[]} config.launchArgs   - Puppeteer launch args
     */
    constructor(config) {
        this.name        = config.name;
        this.minBrowsers = config.minBrowsers;
        this.maxBrowsers = config.maxBrowsers;
        this.autoScale   = config.autoScale !== false;
        this.launchArgs  = config.launchArgs || [];

        /**
         * Configurable free-memory % threshold for auto-scaling.
         * Default 30%; pass 15% for small-RAM plans (Render free = 512 MB).
         */
        this._memSafePercent = config.memSafePercent || DEFAULT_MEM_SAFE_FREE_PERCENT;

        /** Current effective cap (grows from minBrowsers up to maxBrowsers) */
        this.currentMax = config.minBrowsers;

        /** @type {BrowserInstance[]} */
        this.instances = [];

        /** @type {PriorityQueue} */
        this.queue = new PriorityQueue();

        /** @type {PoolMetrics} */
        this.metrics = new PoolMetrics(config.name);

        this.isShuttingDown = false;
        this._executablePath = null;
        this._scaleInterval = null;
        this._recycleInterval = null;
        this._scaleDownTimer = null;

        /**
         * In-flight launch counter — counts browsers currently being launched.
         * Used in the capacity check: live.length + _launching must stay <= maxBrowsers.
         */
        this._launching = 0;
    }

    // ─── Public API ───────────────────────────────────────────────────────────

    /**
     * Initialize the pool — discovers Chromium, pre-warms browsers in parallel,
     * starts auto-scaling and recycling intervals.
     */
    async init() {
        this._executablePath = findChromiumExecutable();

        logger.info(
            `[POOL][${this.name}] Initializing — ` +
            `min=${this.minBrowsers} max=${this.maxBrowsers} autoScale=${this.autoScale}`
        );

        // Pre-warm all minimum browsers in parallel
        const warmResults = await Promise.allSettled(
            Array.from({ length: this.minBrowsers }, () => this._launchAndAdd())
        );

        const warmed = warmResults.filter(r => r.status === 'fulfilled').length;
        this.currentMax = Math.max(this.currentMax, warmed);

        logger.info(
            `[POOL][${this.name}] Pre-warm complete. ` +
            `${warmed}/${this.minBrowsers} browser(s) ready.`
        );

        // Restore any jobs that survived a previous server crash
        await this._restorePersistedJobs();

        // Auto-scaling heartbeat (SYNC_POOL only)
        if (this.autoScale) {
            this._scaleInterval = setInterval(
                () => this._adjustPoolSize(),
                SCALE_CHECK_INTERVAL_MS
            );
            if (this._scaleInterval.unref) this._scaleInterval.unref();
        }

        // Periodic idle-browser recycler
        this._recycleInterval = setInterval(
            () => this._recycleIdleBrowsers(),
            RECYCLE_INTERVAL_MS
        );
        if (this._recycleInterval.unref) this._recycleInterval.unref();
    }

    /**
     * Acquire an isolated browser context from the pool.
     *
     * Priority ordering is enforced via the min-heap PriorityQueue.
     * If all browsers are busy, the call blocks until one is released
     * or ACQUIRE_TIMEOUT_MS elapses.
     *
     * @param {Object} opts
     * @param {number}  opts.priority   - JOB_PRIORITY constant
     * @param {string}  opts.requestId  - Correlation ID
     * @param {string}  opts.jobType    - Human-readable job type
     * @param {string}  [opts.userId]   - Student ID (for session affinity)
     * @returns {Promise<{ browserId: string, context: import('puppeteer').BrowserContext, _checkedOutAt: number }>}
     */
    async acquire({ priority, requestId, jobType, userId }) {
        if (this.isShuttingDown) {
            throw new Error(`[POOL][${this.name}] Pool is shutting down — rejecting acquire.`);
        }

        const enqueuedAt = Date.now();
        this.metrics.recordJobQueued(this.queue.length + 1);

        logger.info(
            `[POOL][${this.name}] Job Queued: ` +
            `type=${jobType} req=${requestId} priority=${priority} queueLen=${this.queue.length}`
        );

        // 1. Try to serve immediately from an idle browser
        const immediate = await this._tryImmediateCheckout(userId, requestId, jobType, enqueuedAt);
        if (immediate) return immediate;

        // 2. Try to scale up with a new browser (if within hard cap and memory is safe)
        //    CRITICAL: count live browsers (non-retired) PLUS in-flight launches.
        //    Bug: old code used this.instances.length which includes retired instances
        //    that haven't been spliced yet, causing the pool to exceed maxBrowsers.
        const liveCount = this.instances.filter(b => !b.retired).length;
        if (
            (liveCount + this._launching) < this.maxBrowsers &&
            this._isMemorySafe()
        ) {
            try {
                const newInst = await this._launchAndAdd();
                const result = await this._doCheckout(newInst, requestId, userId);
                const waitMs = Date.now() - enqueuedAt;
                this.metrics.recordJobStarted(waitMs, this.queue.length);
                logger.info(
                    `[POOL][${this.name}] Job Started (cold launch): ` +
                    `type=${jobType} wait=${waitMs}ms browsers=${liveCount + 1}/${this.maxBrowsers}`
                );
                return result;
            } catch (launchErr) {
                logger.warn(
                    `[POOL][${this.name}] Cold launch failed, falling back to queue: ` +
                    `${launchErr.message}`
                );
            }
        }

        // 3. All browsers busy — enqueue and wait with timeout
        logger.warn(
            `[POOL][${this.name}] All ${this.instances.filter(b => !b.retired).length} browsers busy. ` +
            `Queuing request [${requestId}]...`
        );

        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.queue.remove(reject);
                this.metrics.recordTimeout();

                // Prune from Redis persistence
                queuePersistence.complete(`${this.name}:${requestId}`).catch(() => {});

                reject(new Error(
                    `[POOL][${this.name}] Acquire timeout after ${ACQUIRE_TIMEOUT_MS}ms ` +
                    `(req=${requestId} type=${jobType}).`
                ));
            }, ACQUIRE_TIMEOUT_MS);

            this.queue.enqueue({
                priority,
                enqueuedAt,
                resolve,
                reject,
                timer,
                requestId,
                jobType,
                userId,
            });
        });
    }

    /**
     * Release a browser context back to the pool after a job completes.
     *
     * Closes the incognito context, updates reputation, decides if the browser
     * should be recycled, then drains the next queued request.
     *
     * @param {string}  browserId      - BrowserInstance.id returned from acquire()
     * @param {import('puppeteer').BrowserContext} context
     * @param {string}  requestId      - Correlation ID
     * @param {Error|null} error       - Job error (null on success)
     * @param {number}  checkedOutAt   - Timestamp from acquire() result
     */
    async release(browserId, context, requestId, error = null, checkedOutAt = Date.now()) {
        const instance = this.instances.find(b => b.id === browserId);

        if (!instance) {
            // Browser was already removed (crash/recycle race) — just close the context
            logger.warn(
                `[POOL][${this.name}] Release called for unknown browserId: ${browserId} ` +
                `(already removed from pool)`
            );
            try {
                if (context && !context._closed) await context.close();
            } catch (_) {}
            // Count the destruction even on the crash path — keeps leak counter accurate
            this.metrics.recordContextDestroyed();
            return;
        }

        const durationMs = Date.now() - checkedOutAt;
        logger.info(
            `[POOL][${this.name}] Job Finished: ` +
            `req=${requestId} duration=${durationMs}ms error=${error ? error.message : 'none'}`
        );
        this.metrics.recordJobFinished(durationMs);

        // Remove from Redis persistence
        queuePersistence.complete(`${this.name}:${requestId}`).catch(() => {});

        // Checkin: close context, update reputation
        await instance.checkin(context, error);

        // Record context destruction AFTER checkin closes it
        this.metrics.recordContextDestroyed();

        // If the browser needs recycling, replace it and drain queue from replacement
        if (instance.needsRecycle()) {
            logger.info(
                `[POOL][${this.name}] Browser Recycled: ` +
                `${browserId} jobs=${instance.jobCount} uptime=${instance.getStats().uptimeSec}s`
            );
            this.metrics.recordRecycle();
            sessionAffinity.evictBrowser(browserId); // don't route future requests here
            await this._replaceInstance(instance);
        } else {
            // Serve the next queued request immediately
            this._drainQueue(instance);
        }

        this._updatePrometheus();
    }

    /**
     * Returns a status snapshot for /api/browserpool.
     */
    getStatus() {
        const active = this.instances.filter(b => b.inUse && !b.retired).length;
        const idle   = this.instances.filter(b => !b.inUse && !b.retired).length;
        const total  = this.instances.filter(b => !b.retired).length;

        return {
            name:          this.name,
            total,
            active,
            idle,
            queued:        this.queue.length,
            launching:     this._launching,
            minBrowsers:   this.minBrowsers,
            maxBrowsers:   this.maxBrowsers,
            currentCap:    this.currentMax,
            browsers:      this.instances.map(b => b.getStats()),
            metrics:       this.metrics.snapshot(),
            affinity:      sessionAffinity.getStats(),
            system: {
                nodeRssMb:      Math.round(process.memoryUsage().rss / 1024 / 1024),
                sysFreePercent: Math.round((os.freemem() / os.totalmem()) * 100),
            },
        };
    }

    /**
     * Graceful shutdown — reject all queued requests, close all browsers.
     */
    async shutdown() {
        this.isShuttingDown = true;
        logger.info(`[POOL][${this.name}] Initiating shutdown...`);

        if (this._scaleInterval)  clearInterval(this._scaleInterval);
        if (this._recycleInterval) clearInterval(this._recycleInterval);
        if (this._scaleDownTimer) clearTimeout(this._scaleDownTimer);

        // Reject all waiting callers
        this.queue.cancelAll(`[POOL][${this.name}] Pool shut down.`);

        // Close all browsers concurrently
        await Promise.allSettled(
            this.instances.map(inst => inst.destroy('shutdown'))
        );
        this.instances = [];

        // Clear persisted jobs and affinity
        await queuePersistence.clear().catch(() => {});
        sessionAffinity.destroy();

        logger.info(`[POOL][${this.name}] Shutdown complete.`);
    }

    // ─── Private — Checkout ───────────────────────────────────────────────────

    /**
     * Try to immediately serve a request from an idle instance.
     * Prefers session-affine browser; falls back to any idle browser.
     *
     * @returns {Promise<Object>|null} checkout result or null
     */
    async _tryImmediateCheckout(userId, requestId, jobType, enqueuedAt) {
        let target = null;

        // Session affinity: prefer the browser this student used last
        if (userId) {
            const affineBrowserId = sessionAffinity.get(userId);
            if (affineBrowserId) {
                target = this.instances.find(
                    b => b.id === affineBrowserId && !b.inUse && !b.retired && b.healthy
                );
                if (target) {
                    logger.info(
                        `[POOL][${this.name}] Session affinity hit for userId=${userId} → ${affineBrowserId}`
                    );
                }
            }
        }

        // Fallback: first idle healthy browser
        if (!target) {
            target = this.instances.find(b => !b.inUse && !b.retired && b.healthy);
        }

        if (!target) return null;

        try {
            const result = await this._doCheckout(target, requestId, userId);
            const waitMs = Date.now() - enqueuedAt;
            this.metrics.recordJobStarted(waitMs, this.queue.length);
            logger.info(
                `[POOL][${this.name}] Job Started (warm): ` +
                `type=${jobType} req=${requestId} wait=${waitMs}ms`
            );
            return result;
        } catch (err) {
            // Browser failed health check at checkout — mark unhealthy and try again next
            logger.warn(
                `[POOL][${this.name}] Warm checkout failed (${target.id}): ${err.message}. ` +
                `Falling back to cold launch.`
            );
            target.healthy = false;
            return null;
        }
    }

    /**
     * Perform the actual checkout on a specific BrowserInstance.
     */
    async _doCheckout(instance, requestId, userId) {
        const { context } = await instance.checkout(requestId);

        // Record affinity so this student prefers this browser next time
        if (userId) sessionAffinity.record(userId, instance.id);

        // Track context lifecycle for leak detection
        this.metrics.recordContextCreated();

        return {
            browserId: instance.id,
            context,
            _checkedOutAt: Date.now(),
        };
    }

    // ─── Private — Launch & Replace ───────────────────────────────────────────

    /**
     * Launch a new BrowserInstance and add it to the pool.
     *
     * BUG 5 FIX: Removed the shared _launchPromise pattern.
     * When two concurrent callers shared one promise, both received the same
     * BrowserInstance ref. The first caller checked it out; the second caller
     * then tried to checkout the now-inUse instance, causing a silent race
     * condition where the second caller's acquire() returned an inUse browser.
     * The capacity check (liveCount + _launching < maxBrowsers) is the correct
     * throttle — concurrent callers naturally queue via the PriorityQueue
     * and are served by _drainQueue when the new browser is ready.
     */
    async _launchAndAdd() {
        this._launching++;
        let instance;
        try {
            instance = new BrowserInstance({
                poolName:   this.name,
                launchArgs: this.launchArgs,
                onCrash:    (crashed) => this._handleCrash(crashed),
            });
            await instance.launch(this._executablePath);
            this.instances.push(instance);
            this._updatePrometheus();

            const live = this.instances.filter(b => !b.retired).length;
            logger.info(
                `[POOL][${this.name}] Pool size: ${live}/${this.maxBrowsers} ` +
                `(id=${instance.id})`
            );

            return instance;
        } catch (err) {
            logger.error(`[POOL][${this.name}] Browser launch FAILED: ${err.message}`);
            throw err;
        } finally {
            this._launching--;
        }
    }

    /**
     * Handle a browser crash: remove from pool, launch replacement, drain queue.
     * @param {BrowserInstance} crashedInst
     */
    _handleCrash(crashedInst) {
        this.metrics.recordCrash();
        sessionAffinity.evictBrowser(crashedInst.id);

        const idx = this.instances.findIndex(b => b.id === crashedInst.id);
        if (idx >= 0) this.instances.splice(idx, 1);

        if (this.isShuttingDown) return;

        logger.info(`[POOL][${this.name}] Recovering crash — launching replacement browser...`);
        this._launchAndAdd()
            .then(newInst => {
                logger.info(`[POOL][${this.name}] Replacement browser ready: ${newInst.id}`);
                this._drainQueue(newInst);
            })
            .catch(err => {
                logger.error(`[POOL][${this.name}] Recovery launch failed: ${err.message}`);
            });
        this._updatePrometheus();
    }

    /**
     * Recycle a browser: remove, destroy, launch replacement.
     * @param {BrowserInstance} instance
     */
    async _replaceInstance(instance) {
        const idx = this.instances.findIndex(b => b.id === instance.id);
        if (idx >= 0) this.instances.splice(idx, 1);

        // Destroy asynchronously — don't await so the queue is not blocked
        instance.destroy('recycle').catch(() => {});

        if (this.isShuttingDown) return;

        try {
            const newInst = await this._launchAndAdd();
            this._drainQueue(newInst);
        } catch (err) {
            logger.error(
                `[POOL][${this.name}] Replacement launch after recycle failed: ${err.message}`
            );
        }
    }

    // ─── Private — Queue drain ────────────────────────────────────────────────

    /**
     * Serve the next waiting request from the priority queue using a free browser.
     * No-op if the queue is empty.
     * @param {BrowserInstance} freeInstance
     */
    _drainQueue(freeInstance) {
        if (this.queue.isEmpty) return;
        if (freeInstance.inUse || freeInstance.retired) return;

        const next = this.queue.dequeue();
        if (!next) return;

        clearTimeout(next.timer);
        const waitMs = Date.now() - next.enqueuedAt;

        logger.info(
            `[POOL][${this.name}] Job Started (dequeued): ` +
            `type=${next.jobType} req=${next.requestId} wait=${waitMs}ms ` +
            `queueRemaining=${this.queue.length}`
        );
        this.metrics.recordJobStarted(waitMs, this.queue.length);

        queuePersistence.complete(`${this.name}:${next.requestId}`).catch(() => {});

        this._doCheckout(freeInstance, next.requestId, next.userId)
            .then(next.resolve)
            .catch(next.reject);
    }

    // ─── Private — Auto-scaling ───────────────────────────────────────────────

    /**
     * Adaptive pool size adjustment.
     * Scale UP:   queue is growing + memory is safe + under cap
     * Scale DOWN: queue is empty + excess idle browsers + hysteresis elapsed
     */
    _adjustPoolSize() {
        if (this.isShuttingDown) return;

        const queueDepth = this.queue.length;
        const liveCount  = this.instances.filter(b => !b.retired).length;
        const idleCount  = this.instances.filter(b => !b.inUse && !b.retired).length;

        // Scale UP: only if there's room in both the cap AND memory is safe AND no launch in progress
        if (
            queueDepth > 0 &&
            this.currentMax < this.maxBrowsers &&
            liveCount < this.maxBrowsers &&
            this._launching === 0 &&
            this._isMemorySafe()
        ) {
            const newMax = Math.min(this.currentMax + 1, this.maxBrowsers);
            logger.info(
                `[POOL][${this.name}] Auto-scaling UP: ` +
                `currentMax ${this.currentMax} → ${newMax} ` +
                `(queueDepth=${queueDepth} freeMem=${this._freeMemPercent()}% live=${liveCount})`
            );
            this.currentMax = newMax;

            this._launchAndAdd()
                .then(newInst => this._drainQueue(newInst))
                .catch(err =>
                    logger.error(`[POOL][${this.name}] Scale-up launch failed: ${err.message}`)
                );

            // Cancel any pending scale-down timer
            if (this._scaleDownTimer) {
                clearTimeout(this._scaleDownTimer);
                this._scaleDownTimer = null;
            }
            return;
        }

        // Scale DOWN (with hysteresis)
        // BUG 4 FIX: `activeCount` was never declared in this scope — caused a
        // ReferenceError crashing the auto-scale setInterval every 5 seconds.
        // The correct guard is: no queued work, excess idle browsers above minimum.
        // We compute activeCount from the instance list, consistent with the rest
        // of _adjustPoolSize.
        const activeCount = this.instances.filter(b => b.inUse && !b.retired).length;
        if (
            queueDepth === 0 &&
            idleCount > this.minBrowsers &&
            this.currentMax > this.minBrowsers &&
            activeCount === 0
        ) {
            if (!this._scaleDownTimer) {
                this._scaleDownTimer = setTimeout(async () => {
                    this._scaleDownTimer = null;
                    // Confirm conditions still hold after hysteresis delay
                    if (
                        this.queue.length === 0 &&
                        this.currentMax > this.minBrowsers
                    ) {
                        const newMax = Math.max(this.currentMax - 1, this.minBrowsers);
                        logger.info(
                            `[POOL][${this.name}] Auto-scaling DOWN: ` +
                            `currentMax ${this.currentMax} → ${newMax}`
                        );
                        this.currentMax = newMax;

                        // Retire one excess idle browser
                        const excess = this.instances.find(
                            b => !b.inUse && !b.retired
                        );
                        if (excess) {
                            const idx = this.instances.findIndex(b => b.id === excess.id);
                            if (idx >= 0) this.instances.splice(idx, 1);
                            this.metrics.recordRecycle();
                            sessionAffinity.evictBrowser(excess.id);
                            await excess.destroy('scale-down').catch(() => {});
                            this._updatePrometheus();
                        }
                    }
                }, SCALE_DOWN_HYSTERESIS_MS);

                if (this._scaleDownTimer.unref) this._scaleDownTimer.unref();
            }
        } else if (this._scaleDownTimer) {
            // Conditions no longer hold — cancel the pending scale-down
            clearTimeout(this._scaleDownTimer);
            this._scaleDownTimer = null;
        }
    }

    // ─── Private — Idle recycling ─────────────────────────────────────────────

    /**
     * Recycle browsers that have been idle for IDLE_RECYCLE_MS.
     * Always keeps at least minBrowsers warm.
     */
    async _recycleIdleBrowsers() {
        if (this.isShuttingDown) return;
        const now = Date.now();

        const toRecycle = this.instances.filter(b =>
            !b.inUse &&
            !b.retired &&
            b.lastUsed > 0 &&
            (now - b.lastUsed) > IDLE_RECYCLE_MS
        );

        for (const inst of toRecycle) {
            const activeCount = this.instances.filter(b => !b.retired).length;
            if (activeCount <= this.minBrowsers) break; // keep minimum warm

            const idleSec = Math.round((now - inst.lastUsed) / 1000);
            logger.info(
                `[POOL][${this.name}] Browser Recycled (idle): ${inst.id} ` +
                `idle=${idleSec}s`
            );
            this.metrics.recordRecycle();
            sessionAffinity.evictBrowser(inst.id);
            await this._replaceInstance(inst);
        }

        // Periodic context leak check — runs every 2 min (RECYCLE_INTERVAL_MS)
        // Logs CRITICAL if any context was created but never destroyed.
        this.metrics.detectLeaks();
    }

    // ─── Private — Queue persistence ─────────────────────────────────────────

    /**
     * On startup, restore pending jobs from Redis that survived a crash.
     * These are re-submitted as background sync jobs so the data is not lost.
     */
    async _restorePersistedJobs() {
        const jobs = await queuePersistence.restore().catch(() => []);
        if (jobs.length === 0) return;

        // We do NOT re-enqueue here — the jobs contain metadata only.
        // The correct recovery path is: BullMQ already re-queues sync jobs.
        // We simply clear the browser-pool-level persistence so they don't
        // accumulate across restarts.
        logger.info(
            `[POOL][${this.name}] Clearing ${jobs.length} stale persisted job(s) ` +
            `(BullMQ handles re-queueing at the application level).`
        );
        await queuePersistence.clear().catch(() => {});
    }

    // ─── Private — Helpers ────────────────────────────────────────────────────

    _isMemorySafe() {
        return this._freeMemPercent() > this._memSafePercent;
    }

    _freeMemPercent() {
        return Math.round((os.freemem() / os.totalmem()) * 100);
    }

    _updatePrometheus() {
        try {
            const m = require('../metricsService').metrics;
            const active = this.instances.filter(b => b.inUse && !b.retired).length;
            const total  = this.instances.filter(b => !b.retired).length;
            m.browserPoolActiveBrowsers.set(total);
            m.browserPoolActiveContexts.set(active);
        } catch (_) {}
    }
}

module.exports = BrowserPool;
