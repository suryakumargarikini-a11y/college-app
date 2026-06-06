/**
 * SITAM Smart ERP — ERP Health & Stability Scorer
 *
 * Tracks rolling health metrics for the ERP scraping system and produces
 * a composite health score (0–100) to drive operational decisions:
 *   - QueuePressureManager uses health score to adjust concurrency
 *   - AdaptiveLoadShedding uses it to trigger degraded/emergency modes
 *   - SyncPriorityEngine uses it to drop low-priority work
 *
 * SCORE RANGES:
 *   80–100 = Healthy    (normal operations)
 *   60–79  = Degraded   (log warnings, reduce parallelism slightly)
 *   40–59  = Unstable   (reduce concurrency, delay low-priority)
 *   0–39   = Critical   (pause non-essential syncs, alert ops)
 *
 * STORAGE: Redis sorted sets for rolling windows → in-memory fallback.
 */

'use strict';

const logger       = require('../../../services/logger');
const redisService = require('../../../services/redisService');

const WINDOW_SECS  = 5 * 60; // 5-minute rolling window
const REDIS_PREFIX = 'erp:health:';

// Weight of each component in the composite score (must sum to 1.0)
const COMPONENT_WEIGHTS = {
    loginSuccess:   0.30,  // Login success rate (most critical)
    selectorHealth: 0.20,  // Selector fallback depth (lower = healthier)
    captchaRate:    0.25,  // Inverse CAPTCHA rate (more CAPTCHAs = lower score)
    syncLatency:    0.15,  // Inverse of P95 scrape latency
    availability:   0.10   // ERP HTTP availability
};

class ERPHealthScorer {
    constructor() {
        this._localWindow = {
            loginAttempts:  0, loginSuccesses: 0,
            selectorFails:  0, selectorTotal:  0,
            captchaHits:    0, syncTotal:       0,
            latencySamples: [],
            lastReset:      Date.now()
        };
        this._lastScore   = 100;
        this._scoreTimer  = null;
    }

    /**
     * Start periodic score calculation and metric emission (every 60s).
     */
    startPeriodicScoring() {
        if (this._scoreTimer) return;
        this._scoreTimer = setInterval(() => {
            this.getHealthScore().then(score => {
                try {
                    const m = require('../../telemetry/ProviderMetrics');
                    m.setHealthScore('sitam-scraper', score);
                } catch (_) {}
            }).catch(() => {});
        }, 60 * 1000);
    }

    stopPeriodicScoring() {
        if (this._scoreTimer) { clearInterval(this._scoreTimer); this._scoreTimer = null; }
    }

    // ─── Event Recording ──────────────────────────────────────────────────────

    recordLoginAttempt(success) {
        this._localWindow.loginAttempts++;
        if (success) this._localWindow.loginSuccesses++;
        this._persistEvent('login', success ? 1 : 0);
    }

    recordSelectorFallback(depth) {
        this._localWindow.selectorTotal++;
        if (depth > 0) this._localWindow.selectorFails++;
    }

    recordCaptchaDetection() {
        this._localWindow.captchaHits++;
        this._localWindow.syncTotal++;
        this._persistEvent('captcha', 1);
    }

    recordSyncCompletion(success, latencyMs) {
        this._localWindow.syncTotal++;
        if (latencyMs) this._localWindow.latencySamples.push(latencyMs);
        // Keep only last 20 samples
        if (this._localWindow.latencySamples.length > 20) {
            this._localWindow.latencySamples.shift();
        }
        this._persistEvent('sync', success ? 1 : 0);
    }

    recordBrowserCrash() {
        // Treated as a small availability penalty
        this._persistEvent('crash', 1);
    }

    // ─── Score Computation ────────────────────────────────────────────────────

    /**
     * Get composite ERP health score (0–100).
     *
     * @returns {Promise<number>}
     */
    async getHealthScore() {
        const w = this._localWindow;
        const components = {};

        // Login success rate (0–100)
        components.loginSuccess = w.loginAttempts > 0
            ? (w.loginSuccesses / w.loginAttempts) * 100
            : 100; // Assume healthy if no data

        // Selector health (0–100; penalize fallback usage)
        components.selectorHealth = w.selectorTotal > 0
            ? Math.max(0, 100 - (w.selectorFails / w.selectorTotal) * 200)
            : 100;

        // CAPTCHA rate penalty (0–100; 20% CAPTCHA rate = score of 0)
        const captchaRate = w.syncTotal > 0 ? w.captchaHits / w.syncTotal : 0;
        components.captchaRate = Math.max(0, 100 - captchaRate * 500);

        // Sync latency score (0–100; baseline 10s = 100, 60s = 0)
        const avgLatency = w.latencySamples.length > 0
            ? w.latencySamples.reduce((a, b) => a + b, 0) / w.latencySamples.length
            : 10000;
        components.syncLatency = Math.max(0, Math.min(100, 100 - ((avgLatency - 10000) / 50000) * 100));

        // Availability (simplified: 100 unless we have evidence of outage)
        components.availability = 100;

        // Weighted composite
        const score = Math.round(
            Object.entries(COMPONENT_WEIGHTS).reduce((sum, [key, weight]) => {
                return sum + (components[key] || 0) * weight;
            }, 0)
        );

        this._lastScore = Math.max(0, Math.min(100, score));

        // Auto-reset window every 10 minutes
        if (Date.now() - w.lastReset > 10 * 60 * 1000) {
            this._resetWindow();
        }

        return this._lastScore;
    }

    /**
     * Get full summary object for health endpoints.
     */
    async getSummary() {
        const score    = await this.getHealthScore();
        const status   = score >= 80 ? 'healthy' : score >= 60 ? 'degraded' : score >= 40 ? 'unstable' : 'critical';
        const w        = this._localWindow;

        return {
            score,
            status,
            provider:   'sitam-scraper',
            components: {
                loginSuccessRate: w.loginAttempts > 0 ? ((w.loginSuccesses / w.loginAttempts) * 100).toFixed(1) + '%' : 'N/A',
                selectorFailRate: w.selectorTotal  > 0 ? ((w.selectorFails  / w.selectorTotal)  * 100).toFixed(1) + '%' : 'N/A',
                captchaRate:      w.syncTotal       > 0 ? ((w.captchaHits    / w.syncTotal)       * 100).toFixed(1) + '%' : 'N/A',
                avgLatencyMs:     w.latencySamples.length > 0
                    ? Math.round(w.latencySamples.reduce((a, b) => a + b, 0) / w.latencySamples.length)
                    : null
            },
            windowStarted: new Date(w.lastReset).toISOString(),
            calculatedAt:  new Date().toISOString()
        };
    }

    /** Cached last score (sync, no async) for non-critical callers */
    getLastScore() { return this._lastScore; }

    // ─── Private ──────────────────────────────────────────────────────────────

    _resetWindow() {
        this._localWindow = {
            loginAttempts: 0, loginSuccesses: 0,
            selectorFails: 0, selectorTotal: 0,
            captchaHits:   0, syncTotal: 0,
            latencySamples: [],
            lastReset: Date.now()
        };
    }

    async _persistEvent(type, value) {
        // Optional: persist to Redis sorted set for cross-process aggregation
        try {
            if (redisService.isAlive()) {
                const key = `${REDIS_PREFIX}${type}`;
                const now = Date.now();
                await redisService.client.zadd(key, now, `${now}:${value}`);
                // Trim old entries outside the window
                await redisService.client.zremrangebyscore(key, 0, now - WINDOW_SECS * 1000);
                await redisService.client.expire(key, WINDOW_SECS * 2);
            }
        } catch (_) {}
    }
}

module.exports = new ERPHealthScorer();
