/**
 * SITAM Smart ERP — Browser Reputation & Trust Scoring
 *
 * Tracks per-browser-instance health metrics and produces a trust score (0–100).
 * Low-trust browsers are quarantined and retired from the pool.
 *
 * TRUST SCORE FACTORS:
 *   - CAPTCHA frequency       (weight: 35%) — most critical signal
 *   - Crash/disconnect rate   (weight: 25%)
 *   - Timeout rate            (weight: 20%)
 *   - Suspicious redirects    (weight: 10%)
 *   - Anti-bot trigger rate   (weight: 10%)
 *
 * THRESHOLDS:
 *   80–100 = Healthy    (full utilization)
 *   60–79  = Degraded   (log warning)
 *   40–59  = Suspicious (reduced utilization, early recycle after job)
 *   0–39   = Quarantined (removed from pool immediately)
 */

'use strict';

const logger = require('../../../services/logger');

const RETIRE_THRESHOLD     = 0;
const QUARANTINE_THRESHOLD = 25;
const DEGRADED_THRESHOLD   = 50;
const WARNING_THRESHOLD    = 75;

class BrowserReputationManager {
    constructor() {
        // browserId → reputation record
        this._records      = new Map();
        this._quarantined  = new Set();
        this._retirements  = 0;
        this._quarantines  = 0;
    }

    /**
     * Register a new browser instance in the reputation system.
     *
     * @param {string} browserId
     */
    registerBrowser(browserId) {
        this._records.set(browserId, {
            browserId,
            trustScore:          100,
            captchaEvents:       0,
            crashEvents:         0,
            timeoutEvents:       0,
            suspiciousRedirects: 0,
            antiBotEvents:       0,
            totalJobs:           0,
            successfulJobs:      0,
            registeredAt:        Date.now(),
            lastJobAt:           null,
            state:               'healthy'
        });
        logger.debug(`[BrowserReputation] Registered browser: ${browserId}`);
    }

    /**
     * Record a CAPTCHA detection event for a browser.
     */
    recordCaptcha(browserId) {
        this._mutate(browserId, r => {
            r.captchaEvents++;
            r.trustScore = Math.max(0, r.trustScore - 25);
        });
        this._evaluate(browserId, 'captcha');
    }

    /**
     * Record a browser crash or unexpected disconnect.
     */
    recordCrash(browserId) {
        this._mutate(browserId, r => {
            r.crashEvents++;
            r.trustScore = Math.max(0, r.trustScore - 35);
        });
        this._evaluate(browserId, 'crash');
    }

    /**
     * Record a navigation timeout.
     */
    recordTimeout(browserId) {
        this._mutate(browserId, r => {
            r.timeoutEvents++;
            r.trustScore = Math.max(0, r.trustScore - 15);
        });
        this._evaluate(browserId, 'timeout');
    }

    /**
     * Record a suspicious redirect (non-ERP domain, session corruption, etc.)
     */
    recordSuspiciousRedirect(browserId) {
        this._mutate(browserId, r => {
            r.suspiciousRedirects++;
            r.trustScore = Math.max(0, r.trustScore - 12);
        });
        this._evaluate(browserId, 'suspicious_redirect');
    }

    /**
     * Record an anti-bot trigger (challenge page hit, not necessarily CAPTCHA).
     */
    recordAntiBotTrigger(browserId) {
        this._mutate(browserId, r => {
            r.antiBotEvents++;
            r.trustScore = Math.max(0, r.trustScore - 15);
        });
        this._evaluate(browserId, 'antibot');
    }

    /**
     * Record a successful job completion (small trust recovery).
     */
    recordSuccess(browserId) {
        this._mutate(browserId, r => {
            r.totalJobs++;
            r.successfulJobs++;
            r.lastJobAt  = Date.now();
            r.trustScore = Math.min(100, r.trustScore + 2); // Small recovery per success
        });
    }

    /**
     * Record a job completion (regardless of success).
     */
    recordJob(browserId, success) {
        if (success) {
            this.recordSuccess(browserId);
        } else {
            this._mutate(browserId, r => { r.totalJobs++; r.lastJobAt = Date.now(); });
        }
    }

    /**
     * Get the trust score for a browser.
     *
     * @param {string} browserId
     * @returns {number} 0–100
     */
    getTrustScore(browserId) {
        return this._records.get(browserId)?.trustScore ?? 100;
    }

    /**
     * Is a browser currently quarantined?
     */
    isQuarantined(browserId) {
        return this.getTrustScore(browserId) <= QUARANTINE_THRESHOLD;
    }

    /**
     * Should a browser be recycled after its current job (soft quarantine)?
     */
    shouldRecycleAfterJob(browserId) {
        const score = this.getTrustScore(browserId);
        return score <= DEGRADED_THRESHOLD;
    }

    /**
     * Is a browser retired?
     */
    isRetired(browserId) {
        return this.getTrustScore(browserId) <= RETIRE_THRESHOLD;
    }

    /**
     * Remove browser from tracking (called when browser is closed).
     */
    retire(browserId) {
        this._records.delete(browserId);
        this._quarantined.delete(browserId);
        this._retirements++;
        this._recordMetrics('retirement');
        logger.info(`[BrowserReputation] Browser retired: ${browserId}`);
    }

    /**
     * Get the healthiest available browser ID from a list of candidates.
     *
     * @param {string[]} browserIds
     * @returns {string|null}
     */
    selectHealthiest(browserIds) {
        const eligible = browserIds.filter(id => !this.isQuarantined(id) && !this.isRetired(id));
        if (eligible.length === 0) return null;

        return eligible.reduce((best, id) => {
            return this.getTrustScore(id) > this.getTrustScore(best) ? id : best;
        });
    }

    /**
     * Get full reputation summary for all browsers.
     */
    getSummary() {
        const records = [...this._records.values()].map(r => ({
            browserId:    r.browserId,
            trustScore:   r.trustScore,
            state:        r.state,
            captchas:     r.captchaEvents,
            crashes:      r.crashEvents,
            timeouts:     r.timeoutEvents,
            totalJobs:    r.totalJobs,
            successRate:  r.totalJobs > 0 ? ((r.successfulJobs / r.totalJobs) * 100).toFixed(1) + '%' : 'N/A'
        }));

        return {
            browsers:      records,
            quarantined:   this._quarantined.size,
            retirements:   this._retirements,
            quarantines:   this._quarantines,
            healthiest:    records.filter(r => r.trustScore >= 80).length,
            suspicious:    records.filter(r => r.trustScore < 60).length
        };
    }

    // ─── Private ──────────────────────────────────────────────────────────────

    _mutate(browserId, fn) {
        const record = this._records.get(browserId);
        if (!record) return;
        fn(record);
    }

    _evaluate(browserId, event) {
        const record = this._records.get(browserId);
        if (!record) return;

        const score = record.trustScore;

        if (score <= RETIRE_THRESHOLD) {
            record.state = 'retired';
            logger.warn(`[BrowserReputation] Browser RETIRED: ${browserId} (trust: ${score}, event: ${event})`);
        } else if (score <= QUARANTINE_THRESHOLD) {
            if (!this._quarantined.has(browserId)) {
                this._quarantined.add(browserId);
                this._quarantines++;
                this._recordMetrics('quarantine');
            }
            record.state = 'quarantined';
            logger.warn(`[BrowserReputation] Browser QUARANTINED: ${browserId} (trust: ${score}, event: ${event})`);
        } else if (score <= DEGRADED_THRESHOLD) {
            record.state = 'degraded';
            logger.warn(`[BrowserReputation] Browser DEGRADED: ${browserId} (trust: ${score}, event: ${event})`);
        } else if (score <= WARNING_THRESHOLD) {
            record.state = 'warning';
            logger.warn(`[BrowserReputation] Browser WARNING: ${browserId} (trust: ${score}, event: ${event})`);
        } else {
            record.state = 'healthy';
        }

        this._recordMetrics('score_update', browserId, score);
    }

    _recordMetrics(event, browserId, score) {
        try {
            const m = require('../../telemetry/ProviderMetrics');
            if (event === 'quarantine')    m.recordBrowserQuarantine('sitam-scraper');
            else if (event === 'retirement') m.recordBrowserRetirement('sitam-scraper');
            else if (event === 'score_update' && browserId) m.setBrowserReputationScore(browserId, score);
        } catch (_) {}
    }
}

module.exports = new BrowserReputationManager();
