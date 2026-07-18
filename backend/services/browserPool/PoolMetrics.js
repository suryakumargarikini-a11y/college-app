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
     * Compute a 0–100 health score for this pool.
     *
     * Four independent signals, each can deduct up to 25 points:
     *
     *   1. Crash rate    — crashes per job started (high = browsers unstable)
     *   2. Queue pressure — current queue depth relative to pool cap
     *   3. Wait penalty   — avg queue wait vs acceptable threshold (5 s)
     *   4. Context leak   — any leaked contexts = immediate penalty
     *
     * Returns:
     *   { score: 0-100, status: 'healthy'|'degraded'|'critical'|'down', breakdown: {...} }
     *
     * Interpretation:
     *   90–100  healthy   — operating normally
     *   70–89   degraded  — elevated load or minor instability; monitor closely
     *   40–69   critical  — intervention recommended
     *   0–39    down      — pool not serving requests reliably
     */
    computeHealthScore(currentQueueDepth = 0, poolCap = 1) {
        const breakdown = {};

        // ── Signal 1: Crash Rate (0–25) ─────────────────────────────────────
        // Formula: penalty = 25 × min(crashes / max(1, jobsStarted), 1)
        // A crash rate of 5% = ~1.25 pts penalty. 100% crash rate = 25 pts.
        const crashRate = this.crashesTotal / Math.max(1, this.jobsStartedTotal);
        const crashPenalty = Math.min(25, Math.round(crashRate * 25 * 100) / 100);
        breakdown.crashRate = { crashRate: Math.round(crashRate * 1000) / 10 + '%', penalty: crashPenalty };

        // ── Signal 2: Queue Pressure (0–25) ─────────────────────────────────
        // Formula: penalty = 25 × min(queueDepth / poolCap, 1)
        // Fully-loaded queue = full 25 pt deduction; empty queue = 0.
        const queueRatio   = Math.min(currentQueueDepth / Math.max(1, poolCap), 1);
        const queuePenalty = Math.round(queueRatio * 25 * 100) / 100;
        breakdown.queuePressure = { depth: currentQueueDepth, cap: poolCap, penalty: queuePenalty };

        // ── Signal 3: Wait Time (0–25) ───────────────────────────────────────
        // Acceptable threshold: 5 000 ms. Penalty scales linearly up to 30 000 ms.
        const WAIT_OK_MS  = 5_000;
        const WAIT_MAX_MS = 30_000;
        const waitRatio   = Math.min(Math.max(0, this.avgWaitMs - WAIT_OK_MS) / (WAIT_MAX_MS - WAIT_OK_MS), 1);
        const waitPenalty = Math.round(waitRatio * 25 * 100) / 100;
        breakdown.waitTime = { avgWaitMs: Math.round(this.avgWaitMs), penalty: waitPenalty };

        // ── Signal 4: Context Leak (0–25) ────────────────────────────────────
        // Any leaked context = 25 pt deduction (binary: either leaking or not).
        // A context leak is always critical — it means memory is growing unboundedly.
        const leaked     = Math.max(0, this.contextsCreated - this.contextsDestroyed);
        const leakPenalty = leaked > 0 ? 25 : 0;
        breakdown.contextLeak = { leaked, penalty: leakPenalty };

        // ── Final score ──────────────────────────────────────────────────────
        const score  = Math.round(Math.max(0, 100 - crashPenalty - queuePenalty - waitPenalty - leakPenalty));
        let status;
        if (score >= 90)      status = 'healthy';
        else if (score >= 70) status = 'degraded';
        else if (score >= 40) status = 'critical';
        else                  status = 'down';

        return { score, status, breakdown };
    }

    /**
     * Returns a plain object snapshot for JSON serialisation.
     * @returns {Object}
     */
    snapshot(currentQueueDepth = 0, poolCap = 1) {
        const leaked  = this.contextsCreated - this.contextsDestroyed;
        const health  = this.computeHealthScore(currentQueueDepth, poolCap);
        return {
            poolName:           this.poolName,
            // ── Health ──────────────────────────────────────────────────────
            healthScore:        health.score,
            healthStatus:       health.status,
            healthBreakdown:    health.breakdown,
            // ── Performance ─────────────────────────────────────────────────
            avgWaitMs:          Math.round(this.avgWaitMs),
            avgJobDurationMs:   Math.round(this.avgJobDurationMs),
            peakQueueDepth:     this.peakQueueDepth,
            // ── Reliability ─────────────────────────────────────────────────
            crashesTotal:       this.crashesTotal,
            recycledTotal:      this.recycledTotal,
            timeoutsTotal:      this.timeoutsTotal,
            // ── Throughput ──────────────────────────────────────────────────
            jobsStartedTotal:   this.jobsStartedTotal,
            jobsFinishedTotal:  this.jobsFinishedTotal,
            // ── Memory ──────────────────────────────────────────────────────
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
