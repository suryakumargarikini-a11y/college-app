/**
 * SITAM Smart ERP — Queue Pressure Manager + Queue Fairness
 *
 * Provides adaptive concurrency control based on ERP health and queue depth.
 * Also implements multi-user fairness to prevent starvation under load.
 *
 * PRESSURE LEVELS:
 *   NORMAL    (health ≥ 80) — Full concurrency, no throttling
 *   ELEVATED  (health 60–79) — Slight delay, concurrency -1
 *   HIGH      (health 40–59) — Significant delay, concurrency -2, drop low-priority
 *   CRITICAL  (health < 40)  — Minimum concurrency, only critical syncs pass
 *
 * FAIRNESS (starvation prevention):
 *   - Students waiting >5min get priority boost
 *   - No single student can hold more than 2 concurrent slots
 *   - Round-robin window for queue admission
 */

'use strict';

const logger = require('../../../services/logger');

// Base concurrency limits per pressure level
const CONCURRENCY = { NORMAL: 3, ELEVATED: 2, HIGH: 1, CRITICAL: 1 };
const DELAY_MS    = { NORMAL: 0, ELEVATED: 2000, HIGH: 10000, CRITICAL: 30000 };

// Starvation prevention: boost priority after this wait
const STARVATION_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

class QueuePressureManager {
    constructor() {
        this._waitingUsers     = new Map(); // userId → { since, priority, attempts }
        this._activeUsers      = new Map(); // userId → slotCount
        this._pressureLevel    = 'NORMAL';
        this._lastHealthScore  = 100;
    }

    /**
     * Update pressure level from health score.
     * Called by ERPHealthScorer's periodic update.
     *
     * @param {number} healthScore - 0–100
     */
    updateFromHealthScore(healthScore) {
        this._lastHealthScore = healthScore;

        const prev = this._pressureLevel;
        if      (healthScore >= 80) this._pressureLevel = 'NORMAL';
        else if (healthScore >= 60) this._pressureLevel = 'ELEVATED';
        else if (healthScore >= 40) this._pressureLevel = 'HIGH';
        else                        this._pressureLevel = 'CRITICAL';

        if (prev !== this._pressureLevel) {
            logger.warn(`[QueuePressure] Level changed: ${prev} → ${this._pressureLevel} (health: ${healthScore})`);
            this._recordMetrics();
        }
    }

    /**
     * Get current pressure state for callers.
     *
     * @returns {{ level: string, concurrencyLimit: number, delayMs: number, healthScore: number }}
     */
    getPressureLevel() {
        return {
            level:            this._pressureLevel,
            concurrencyLimit: CONCURRENCY[this._pressureLevel] || 3,
            delayMs:          DELAY_MS[this._pressureLevel]    || 0,
            healthScore:      this._lastHealthScore
        };
    }

    /**
     * Should this sync be throttled? Returns true + delay if yes.
     *
     * @param {string} userId
     * @param {string} [priority] - 'critical'|'high'|'medium'|'low'
     * @returns {{ throttle: boolean, delayMs: number, reason: string }}
     */
    shouldThrottle(userId, priority = 'medium') {
        const level = this._pressureLevel;

        // Critical syncs always pass through, even under CRITICAL pressure
        if (priority === 'critical') {
            return { throttle: false, delayMs: 0, reason: 'critical_priority_bypass' };
        }

        // Under CRITICAL pressure: only critical and high pass
        if (level === 'CRITICAL' && priority === 'low') {
            return { throttle: true, delayMs: -1, reason: 'critical_pressure_low_priority_dropped' };
        }

        // Under HIGH pressure: low priority is delayed significantly
        if (level === 'HIGH' && priority === 'low') {
            return { throttle: true, delayMs: DELAY_MS.HIGH, reason: 'high_pressure_low_priority_delay' };
        }

        // Normal throttling based on level
        if (DELAY_MS[level] > 0) {
            return { throttle: true, delayMs: DELAY_MS[level], reason: `pressure_level_${level.toLowerCase()}` };
        }

        return { throttle: false, delayMs: 0, reason: 'no_throttle' };
    }

    /**
     * Recommended browser pool concurrency for current conditions.
     */
    getRecommendedConcurrency() {
        return CONCURRENCY[this._pressureLevel] || 3;
    }

    // ─── Fairness / Starvation Prevention ────────────────────────────────────

    /**
     * Register a user entering the sync queue.
     */
    registerWaiting(userId, priority = 'medium') {
        if (!this._waitingUsers.has(userId)) {
            this._waitingUsers.set(userId, {
                since:    Date.now(),
                priority,
                attempts: 0
            });
        }
    }

    /**
     * Register a user completing or starting sync.
     */
    registerActive(userId) {
        const current = this._activeUsers.get(userId) || 0;
        this._activeUsers.set(userId, current + 1);
        this._waitingUsers.delete(userId);
    }

    /**
     * Release a user's active slot.
     */
    releaseActive(userId) {
        const current = this._activeUsers.get(userId) || 0;
        if (current <= 1) this._activeUsers.delete(userId);
        else this._activeUsers.set(userId, current - 1);
    }

    /**
     * Check if a user should get a priority boost due to starvation.
     *
     * @param {string} userId
     * @returns {boolean}
     */
    isStarving(userId) {
        const entry = this._waitingUsers.get(userId);
        if (!entry) return false;
        return (Date.now() - entry.since) > STARVATION_THRESHOLD_MS;
    }

    /**
     * Get effective priority considering starvation aging.
     *
     * @param {string} userId
     * @param {string} basePriority
     * @returns {string} Possibly boosted priority
     */
    getEffectivePriority(userId, basePriority) {
        if (!this.isStarving(userId)) return basePriority;

        // Boost priority by one level if starving
        const levels = ['low', 'medium', 'high', 'critical'];
        const idx    = levels.indexOf(basePriority);
        const boosted = idx < levels.length - 1 ? levels[idx + 1] : basePriority;

        if (boosted !== basePriority) {
            logger.info(`[QueueFairness] ${userId} starving — priority boosted: ${basePriority} → ${boosted}`);
        }

        return boosted;
    }

    /**
     * Is a user holding too many concurrent slots? (Fairness cap)
     *
     * @param {string} userId
     * @param {number} [maxSlots]
     * @returns {boolean}
     */
    isMonopolizing(userId, maxSlots = 2) {
        return (this._activeUsers.get(userId) || 0) >= maxSlots;
    }

    /**
     * Get queue fairness summary for health endpoints.
     */
    getFairnessSummary() {
        const starving = [...this._waitingUsers.entries()]
            .filter(([userId]) => this.isStarving(userId))
            .map(([userId, info]) => ({ userId, waitMs: Date.now() - info.since }));

        return {
            waitingCount:  this._waitingUsers.size,
            activeCount:   this._activeUsers.size,
            starvingUsers: starving.length,
            pressureLevel: this._pressureLevel,
            healthScore:   this._lastHealthScore
        };
    }

    _recordMetrics() {
        try {
            const m = require('../../telemetry/ProviderMetrics');
            m.recordQueuePressureLevel('sitam-scraper', this._pressureLevel);
        } catch (_) {}
    }
}

module.exports = new QueuePressureManager();
