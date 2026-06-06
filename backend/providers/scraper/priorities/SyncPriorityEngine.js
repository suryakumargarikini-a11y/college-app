/**
 * SITAM Smart ERP — Sync Priority Engine
 *
 * Implements dynamic priority scoring for ERP sync modules.
 * Integrates with QueuePressureManager and ERPHealthScorer to intelligently
 * shed load while preserving critical synchronization.
 *
 * BASE PRIORITIES (1–10 scale, higher = more important):
 *   profile      → 5  (medium)
 *   marks        → 8  (high)
 *   attendance   → 8  (high)
 *   fees         → 4  (low)
 *   assignments  → 3  (low)
 *
 * ADAPTIVE BOOSTS:
 *   Exam period detected  → marks, attendance +3
 *   Result release time   → marks +4 (global boost for all students)
 *   High queue pressure   → fees, assignments drop below threshold
 *   ERP degraded          → only high-priority modules sync
 *   User-triggered sync   → +2 across all modules (user is waiting)
 */

'use strict';

const logger = require('../../../services/logger');

// Priority levels (maps to BullMQ priority integer: lower = more urgent in BullMQ)
const PRIORITY_NAMES  = { critical: 1, high: 2, medium: 3, low: 4 };
const PRIORITY_LABELS = { 1: 'critical', 2: 'high', 3: 'medium', 4: 'low' };

// Base priority scores (higher internal score = higher importance)
const BASE_SCORES = {
    profile:     5,
    marks:       8,
    attendance:  8,
    fees:        4,
    assignments: 3
};

// Minimum score to be included under each ERP health condition
const INCLUSION_THRESHOLDS = {
    NORMAL:    0,   // All modules
    DEGRADED:  4,   // profile + marks + attendance only
    UNSTABLE:  7,   // marks + attendance only
    CRITICAL:  9    // Emergency-only (nothing makes it unless boosted to 9+)
};

class SyncPriorityEngine {
    constructor() {
        this._globalBoosts = {};    // module → boost amount (for global events like result release)
        this._examPeriod   = false;
        this._resultRelease = false;
    }

    /**
     * Get the ordered list of modules to sync based on current conditions.
     * Modules below the health threshold are excluded.
     *
     * @param {{ healthStatus?: string, triggeredByUser?: boolean, isResume?: boolean }} [ctx]
     * @returns {string[]} Ordered list of module names to sync
     */
    getModuleOrder(ctx = {}) {
        const healthStatus   = ctx.healthStatus   || 'NORMAL';
        const triggeredByUser = ctx.triggeredByUser || false;
        const isResume        = ctx.isResume        || false;
        const threshold       = INCLUSION_THRESHOLDS[healthStatus] || 0;

        const scored = Object.entries(BASE_SCORES).map(([module, base]) => {
            let score = base;
            // Apply global boosts (exam period, result release)
            score += this._globalBoosts[module] || 0;
            // User-triggered sync gets a uniform boost
            if (triggeredByUser) score += 2;
            // Resuming partial sync — boost modules that need recovery
            if (isResume) score += 1;
            return { module, score };
        });

        // Filter out low-priority modules under health pressure
        const eligible = scored.filter(({ score }) => score >= threshold);

        // Sort descending by score (most important first)
        eligible.sort((a, b) => b.score - a.score);

        return eligible.map(({ module }) => module);
    }

    /**
     * Get BullMQ priority integer for a sync job.
     * BullMQ: lower number = higher priority.
     *
     * @param {string} [trigger] - 'user'|'background'|'recovery'
     * @returns {number} 1–4
     */
    getBullMQPriority(trigger = 'background') {
        if (trigger === 'user')     return PRIORITY_NAMES.high;
        if (trigger === 'recovery') return PRIORITY_NAMES.high;
        if (this._resultRelease)    return PRIORITY_NAMES.high;
        if (this._examPeriod)       return PRIORITY_NAMES.medium;
        return PRIORITY_NAMES.low;
    }

    /**
     * Get the priority label for a module under current conditions.
     *
     * @param {string} module
     * @param {object} [ctx]
     * @returns {string} 'critical'|'high'|'medium'|'low'
     */
    getModulePriority(module, ctx = {}) {
        const score = (BASE_SCORES[module] || 3) + (this._globalBoosts[module] || 0) +
                      (ctx.triggeredByUser ? 2 : 0);

        if (score >= 10) return 'critical';
        if (score >= 7)  return 'high';
        if (score >= 5)  return 'medium';
        return 'low';
    }

    /**
     * Activate exam period mode — boosts marks and attendance priority globally.
     */
    setExamPeriod(active) {
        this._examPeriod = active;
        if (active) {
            this._globalBoosts.marks      = (this._globalBoosts.marks || 0) + 3;
            this._globalBoosts.attendance = (this._globalBoosts.attendance || 0) + 3;
            logger.info('[SyncPriority] EXAM PERIOD activated — marks + attendance priority boosted');
        } else {
            delete this._globalBoosts.marks;
            delete this._globalBoosts.attendance;
            logger.info('[SyncPriority] Exam period deactivated');
        }
    }

    /**
     * Activate result release mode — maximum marks priority for all students.
     */
    setResultRelease(active) {
        this._resultRelease = active;
        if (active) {
            this._globalBoosts.marks = (this._globalBoosts.marks || 0) + 4;
            logger.info('[SyncPriority] RESULT RELEASE mode activated — marks at maximum priority');
        } else {
            delete this._globalBoosts.marks;
            logger.info('[SyncPriority] Result release mode deactivated');
        }
    }

    /**
     * Apply a custom boost to any module (for admin/operational control).
     *
     * @param {string} module
     * @param {number} boost - Positive or negative integer
     */
    applyBoost(module, boost) {
        this._globalBoosts[module] = (this._globalBoosts[module] || 0) + boost;
        logger.info(`[SyncPriority] Manual boost applied: ${module} +${boost} (new boost: ${this._globalBoosts[module]})`);
    }

    /**
     * Clear all boosts (reset to base priorities).
     */
    clearBoosts() {
        this._globalBoosts = {};
        this._examPeriod   = false;
        this._resultRelease = false;
    }

    /**
     * Get current priority state for health/admin endpoints.
     */
    getState() {
        return {
            examPeriod:     this._examPeriod,
            resultRelease:  this._resultRelease,
            globalBoosts:   { ...this._globalBoosts },
            moduleScores:   Object.fromEntries(
                Object.entries(BASE_SCORES).map(([m, base]) => [m, base + (this._globalBoosts[m] || 0)])
            )
        };
    }
}

module.exports = new SyncPriorityEngine();
