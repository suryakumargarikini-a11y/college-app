'use strict';

/**
 * PoolMetrics — Real-Time Statistics Aggregator for a Single Pool
 *
 * Uses Exponential Moving Average (EMA) for rolling metrics so that
 * recent samples are weighted more heavily than old ones, without
 * storing unbounded history.
 *
 * Formula: EMA = α × newValue + (1 − α) × prevEMA
 * α = 0.2 → 20% weight to newest sample (smooth, not noisy)
 *
 * Metrics tracked per pool:
 *   - avgWaitMs          : EMA of time spent waiting in queue
 *   - avgJobDurationMs   : EMA of time from checkout to release
 *   - peakQueueDepth     : historical maximum queue depth
 *   - crashesTotal       : browser process crashes
 *   - recycledTotal      : browsers recycled (lifetime/jobs limit)
 *   - timeoutsTotal      : acquire timeouts
 *   - jobsStartedTotal   : total jobs that acquired a browser slot
 *   - jobsFinishedTotal  : total jobs that released their browser slot
 *
 * @module PoolMetrics
 */

const EMA_ALPHA = 0.2;

/**
 * @param {number} prev     - Previous EMA value (0 for first sample)
 * @param {number} newVal   - New observed value
 * @param {number} [alpha]  - Smoothing factor
 * @returns {number}
 */
function ema(prev, newVal, alpha = EMA_ALPHA) {
    if (prev === 0) return newVal; // first sample — use raw value
    return alpha * newVal + (1 - alpha) * prev;
}

class PoolMetrics {
    /**
     * @param {string} poolName - 'AUTH_POOL' or 'SYNC_POOL'
     */
    constructor(poolName) {
        this.poolName = poolName;

        // EMA metrics
        this.avgWaitMs = 0;
        this.avgJobDurationMs = 0;

        // Monotonic counters
        this.peakQueueDepth = 0;
        this.crashesTotal = 0;
        this.recycledTotal = 0;
        this.timeoutsTotal = 0;
        this.jobsStartedTotal = 0;
        this.jobsFinishedTotal = 0;

        // ── Context lifecycle counters ─────────────────────────────────────────
        // A context is "created" when checkout() calls createBrowserContext().
        // A context is "destroyed" when checkin() calls context.close().
        // If created != destroyed over time, memory is leaking.
        this.contextsCreated   = 0;
        this.contextsDestroyed = 0;
        this.contextsPeak      = 0; // high-water mark of simultaneously live contexts
    }

    /**
     * Call when a job enters the priority queue (before acquiring a slot).
     * @param {number} currentQueueDepth
     */
    recordJobQueued(currentQueueDepth) {
        if (currentQueueDepth > this.peakQueueDepth) {
            this.peakQueueDepth = currentQueueDepth;
        }
    }

    /**
     * Call when a job successfully acquires a browser slot.
     * @param {number} waitMs          - ms spent in queue
     * @param {number} currentQueueDepth
     */
    recordJobStarted(waitMs, currentQueueDepth) {
        this.jobsStartedTotal++;
        this.avgWaitMs = ema(this.avgWaitMs, waitMs);
        if (currentQueueDepth > this.peakQueueDepth) {
            this.peakQueueDepth = currentQueueDepth;
        }
    }

    /**
     * Call when a job releases its browser slot.
     * @param {number} durationMs - ms from checkout to release
     */
    recordJobFinished(durationMs) {
        this.jobsFinishedTotal++;
        this.avgJobDurationMs = ema(this.avgJobDurationMs, durationMs);
    }

    /**
     * Call when a job times out waiting for a browser slot.
     */
    recordTimeout() {
        this.timeoutsTotal++;
        try {
            require('../metricsService').metrics.browserPoolTimeoutsTotal.inc();
        } catch (_) {}
    }

    /**
     * Call when a browser context is created (checkout).
     */
    recordContextCreated() {
        this.contextsCreated++;
        const live = this.contextsCreated - this.contextsDestroyed;
        if (live > this.contextsPeak) this.contextsPeak = live;
    }

    /**
     * Call when a browser context is destroyed (checkin or crash cleanup).
     */
    recordContextDestroyed() {
        this.contextsDestroyed++;
    }

    /**
     * Detect and report context leaks.
     *
     * A context is "leaked" if it was created but never destroyed.
     * Over time this causes Chromium to hold open tabs and consume memory.
     *
     * Returns { leaked, created, destroyed, peak, critical }
     * where critical=true means a leak has been detected.
     *
     * Call this from a periodic maintenance interval.
     *
     * @returns {{ leaked: number, created: number, destroyed: number, peak: number, critical: boolean }}
     */
    detectLeaks() {
        const leaked = this.contextsCreated - this.contextsDestroyed;
        const critical = leaked > 0;
        if (critical) {
            const logger = require('../logger');
            logger.error(
                `[POOL][${this.poolName}] CRITICAL: Browser Context Leak Detected! ` +
                `created=${this.contextsCreated} destroyed=${this.contextsDestroyed} ` +
                `leaked=${leaked} peak=${this.contextsPeak}. ` +
                `Memory will grow until these contexts are closed. ` +
                `Check for missing checkin() calls or crash paths that skip context.close().`
            );
        }
        return {
            leaked,
            created:   this.contextsCreated,
            destroyed: this.contextsDestroyed,
            peak:      this.contextsPeak,
            critical
        };
    }

    /**
     * Call when a browser process crashes unexpectedly.
     */
    recordCrash() {
        this.crashesTotal++;
        // Prometheus counter is incremented by BrowserInstance.launch() disconnect handler
    }

    /**
     * Call when a browser is recycled (lifetime/jobs limit reached or idle too long).
     */
    recordRecycle() {
        this.recycledTotal++;
        try {
            require('../metricsService').metrics.browserPoolRecycleTotal.inc();
        } catch (_) {}
    }

    /**
     * Returns a plain object snapshot for JSON serialisation.
     * @returns {Object}
     */
    snapshot() {
        const leaked = this.contextsCreated - this.contextsDestroyed;
        return {
            poolName:           this.poolName,
            avgWaitMs:          Math.round(this.avgWaitMs),
            avgJobDurationMs:   Math.round(this.avgJobDurationMs),
            peakQueueDepth:     this.peakQueueDepth,
            crashesTotal:       this.crashesTotal,
            recycledTotal:      this.recycledTotal,
            timeoutsTotal:      this.timeoutsTotal,
            jobsStartedTotal:   this.jobsStartedTotal,
            jobsFinishedTotal:  this.jobsFinishedTotal,
            contexts: {
                created:   this.contextsCreated,
                destroyed: this.contextsDestroyed,
                peak:      this.contextsPeak,
                leaked,
            }
        };
    }
}

module.exports = PoolMetrics;
