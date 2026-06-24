/**
 * SITAM Smart ERP — Performance Timer
 *
 * Lightweight timing utility that wraps console.time() / console.timeEnd()
 * and accumulates structured per-step durations for a sync job.
 *
 * Usage:
 *   const timer = new PerformanceTimer('req-123', 'user01');
 *   timer.start('browserLaunch');
 *   ... await something ...
 *   timer.end('browserLaunch');
 *   const report = timer.report();
 */

const logger = require('./logger');

class PerformanceTimer {
    /**
     * @param {string} requestId - Unique request/job identifier
     * @param {string} userId    - Student user ID
     */
    constructor(requestId, userId) {
        this.requestId = requestId;
        this.userId    = userId;
        this._starts   = {};   // step -> hrtime start
        this._durations = {};  // step -> ms duration
        this._order    = [];   // insertion order for report
        this._totalStart = process.hrtime.bigint();
    }

    /**
     * Start timing a step.
     * @param {string} step
     */
    start(step) {
        this._starts[step] = process.hrtime.bigint();
        if (!this._order.includes(step)) this._order.push(step);
        console.time(`[PERF][${this.requestId}] ${step}`);
    }

    /**
     * End timing a step and record the duration.
     * @param {string} step
     * @returns {number} Duration in milliseconds
     */
    end(step) {
        const endNs = process.hrtime.bigint();
        const startNs = this._starts[step];
        if (!startNs) {
            logger.warn(`[PerformanceTimer] end() called for unstarted step: ${step}`);
            return 0;
        }
        const ms = Number(endNs - startNs) / 1_000_000;
        this._durations[step] = Math.round(ms);
        console.timeEnd(`[PERF][${this.requestId}] ${step}`);
        logger.info(`[PERF][${this.requestId}] ${step}: ${this._durations[step]}ms`);
        return this._durations[step];
    }

    /**
     * Time an async function and return its result.
     * @param {string} step
     * @param {Function} fn  - async function to time
     */
    async measure(step, fn) {
        this.start(step);
        try {
            return await fn();
        } finally {
            this.end(step);
        }
    }

    /**
     * Get duration for a step in ms (0 if not recorded).
     * @param {string} step
     */
    get(step) {
        return this._durations[step] || 0;
    }

    /**
     * Calculate total wall-clock time since the timer was created.
     */
    totalMs() {
        return Math.round(Number(process.hrtime.bigint() - this._totalStart) / 1_000_000);
    }

    /**
     * Generate a structured performance report.
     * @param {object} meta - extra fields to include
     * @returns {object}
     */
    report(meta = {}) {
        const total = this.totalMs();

        const steps = {};
        for (const step of this._order) {
            steps[step] = this._durations[step] ?? null;
        }

        const report = {
            requestId:  this.requestId,
            userId:     this.userId,
            totalMs:    total,
            steps,
            ...meta,
            generatedAt: new Date().toISOString()
        };

        // Emit a single consolidated log line for easy grep
        const stepSummary = this._order
            .map(s => `${s}=${this._durations[s] ?? '?'}ms`)
            .join(' | ');

        logger.info(
            `[PERF-REPORT][${this.requestId}] user=${this.userId} total=${total}ms | ${stepSummary}`
        );

        return report;
    }
}

module.exports = PerformanceTimer;
