/**
 * SITAM Smart ERP — Adaptive Load Shedding
 *
 * Implements graceful degradation under ERP instability.
 * Operates in 4 modes that dynamically control browser pool size,
 * queue concurrency, and sync admission.
 *
 * MODES:
 *   NORMAL    — Full operations (health ≥ 80)
 *   DEGRADED  — Reduced concurrency, low-priority syncs delayed (health 60–79)
 *   PROTECTED — Critical syncs only, pool reduced (health 40–59)
 *   EMERGENCY — All syncs suppressed except manual triggers (health < 40)
 *
 * INTEGRATION POINTS:
 *   - ERPHealthScorer → drives mode transitions
 *   - QueuePressureManager → respects concurrency limits
 *   - SyncPriorityEngine → provides priority for admission decisions
 *   - BrowserReputationManager → reduces pool by retiring bad browsers
 */

'use strict';

const logger = require('../../../services/logger');

const MODES = {
    NORMAL:    { concurrency: 3, poolSize: 5, retryAllowed: true,  lowPriorityAllowed: true,  mediumPriorityAllowed: true  },
    DEGRADED:  { concurrency: 2, poolSize: 3, retryAllowed: true,  lowPriorityAllowed: false, mediumPriorityAllowed: true  },
    PROTECTED: { concurrency: 1, poolSize: 2, retryAllowed: false, lowPriorityAllowed: false, mediumPriorityAllowed: false },
    EMERGENCY: { concurrency: 0, poolSize: 1, retryAllowed: false, lowPriorityAllowed: false, mediumPriorityAllowed: false }
};

// CAPTCHA rate thresholds for triggering PROTECTED mode
const CAPTCHA_RATE_HIGH = 0.15; // 15% of syncs hitting CAPTCHA

class AdaptiveLoadShedding {
    constructor() {
        this._currentMode   = 'NORMAL';
        this._lastHealthScore = 100;
        this._captchaWindow = { hits: 0, total: 0, since: Date.now() };
        this._modeHistory   = [];
        this._cooldownUntil = 0;
    }

    /**
     * Update mode from health score. Call this from ERPHealthScorer's periodic update.
     *
     * @param {number} healthScore - 0–100
     */
    updateFromHealthScore(healthScore) {
        this._lastHealthScore = healthScore;
        const targetMode = this._scorToMode(healthScore);
        this._transitionTo(targetMode, `health_score:${healthScore}`);
    }

    /**
     * Record a CAPTCHA hit — may trigger PROTECTED mode.
     */
    recordCaptchaHit() {
        const w = this._captchaWindow;
        w.hits++;
        w.total++;

        // Reset window every 10 minutes
        if (Date.now() - w.since > 10 * 60 * 1000) {
            w.hits = 1; w.total = 1; w.since = Date.now();
        }

        const rate = w.total > 10 ? w.hits / w.total : 0;
        if (rate > CAPTCHA_RATE_HIGH && this._currentMode === 'NORMAL') {
            logger.warn(`[LoadShedding] High CAPTCHA rate (${(rate * 100).toFixed(1)}%) — forcing PROTECTED mode`);
            this._transitionTo('PROTECTED', `captcha_rate:${(rate * 100).toFixed(1)}%`);
            // Cooldown: stay in PROTECTED for at least 15 minutes
            this._cooldownUntil = Date.now() + 15 * 60 * 1000;
        }
    }

    /**
     * Get admission decision for a sync job.
     *
     * @param {{ priority?: string, triggeredByUser?: boolean }} [ctx]
     * @returns {{ admitted: boolean, mode: string, reason: string }}
     */
    admitSync(ctx = {}) {
        const priority        = ctx.priority        || 'medium';
        const triggeredByUser = ctx.triggeredByUser || false;
        const config          = MODES[this._currentMode];

        // User-triggered syncs always pass through (user is waiting)
        if (triggeredByUser && priority !== 'low') {
            return { admitted: true, mode: this._currentMode, reason: 'user_triggered_bypass' };
        }

        // EMERGENCY: nothing passes except user-triggered high/critical
        if (this._currentMode === 'EMERGENCY') {
            if (triggeredByUser && (priority === 'critical' || priority === 'high')) {
                return { admitted: true, mode: 'EMERGENCY', reason: 'user_triggered_critical' };
            }
            return { admitted: false, mode: 'EMERGENCY', reason: 'emergency_mode_all_suppressed' };
        }

        // Check priority-based admission
        if (priority === 'low' && !config.lowPriorityAllowed) {
            return { admitted: false, mode: this._currentMode, reason: `${this._currentMode.toLowerCase()}_low_priority_shed` };
        }
        if (priority === 'medium' && !config.mediumPriorityAllowed) {
            return { admitted: false, mode: this._currentMode, reason: `${this._currentMode.toLowerCase()}_medium_priority_shed` };
        }

        return { admitted: true, mode: this._currentMode, reason: 'admitted' };
    }

    /**
     * Get current operational configuration.
     *
     * @returns {{ mode: string, concurrency: number, poolSize: number, retryAllowed: boolean }}
     */
    getCurrentConfig() {
        return { mode: this._currentMode, ...MODES[this._currentMode] };
    }

    /** Is the system in or above PROTECTED mode? */
    isInDegradedState() {
        return this._currentMode !== 'NORMAL';
    }

    /** Is retry allowed in the current mode? */
    isRetryAllowed() {
        return MODES[this._currentMode]?.retryAllowed ?? true;
    }

    /**
     * Get mode history for Grafana/debug.
     *
     * @param {number} [limit]
     * @returns {object[]}
     */
    getModeHistory(limit = 20) {
        return this._modeHistory.slice(-limit);
    }

    /**
     * Get full state summary for health endpoint.
     */
    getSummary() {
        return {
            currentMode:    this._currentMode,
            healthScore:    this._lastHealthScore,
            config:         MODES[this._currentMode],
            captchaRate:    this._captchaWindow.total > 0
                ? ((this._captchaWindow.hits / this._captchaWindow.total) * 100).toFixed(1) + '%'
                : '0%',
            cooldownActive: Date.now() < this._cooldownUntil,
            cooldownEnds:   new Date(this._cooldownUntil).toISOString(),
            recentHistory:  this.getModeHistory(5)
        };
    }

    // ─── Private ──────────────────────────────────────────────────────────────

    _scorToMode(score) {
        if (score >= 80) return 'NORMAL';
        if (score >= 60) return 'DEGRADED';
        if (score >= 40) return 'PROTECTED';
        return 'EMERGENCY';
    }

    _transitionTo(targetMode, reason) {
        // Respect cooldown for PROTECTED mode (prevents flapping)
        if (this._currentMode === 'PROTECTED' && Date.now() < this._cooldownUntil && targetMode === 'NORMAL') {
            logger.debug(`[LoadShedding] Cooldown active — staying in PROTECTED until ${new Date(this._cooldownUntil).toISOString()}`);
            return;
        }

        if (targetMode === this._currentMode) return;

        const prev = this._currentMode;
        this._currentMode = targetMode;

        this._modeHistory.push({
            from: prev, to: targetMode, reason,
            at:   new Date().toISOString()
        });

        logger.warn(`[LoadShedding] Mode transition: ${prev} → ${targetMode} (${reason})`);
        this._recordMetrics(targetMode);
    }

    _recordMetrics(mode) {
        try {
            const m = require('../../telemetry/ProviderMetrics');
            m.recordLoadSheddingMode('sitam-scraper', mode);
        } catch (_) {}
    }
}

module.exports = new AdaptiveLoadShedding();
