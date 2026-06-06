/**
 * SITAM Smart ERP — Adaptive Selector Optimizer
 *
 * Tracks selector performance over time and self-heals by promoting
 * fallback selectors that consistently succeed over primary selectors
 * that consistently fail due to ERP layout evolution.
 *
 * PROMOTION LOGIC:
 *   - Primary selector fails 20 consecutive times → demote
 *   - Fallback selector succeeds 20 consecutive times → promote to primary
 *   - Decay: selector confidence decays 5% per hour of inactivity
 *   - Reset: manual reset if DOMDriftDetector detects severe drift
 *
 * STORAGE: Redis (persistent across restarts) → in-memory fallback
 */

'use strict';

const logger       = require('../../../services/logger');
const redisService = require('../../../services/redisService');
const { ERP_SELECTORS } = require('./ERPSelectors');

const REDIS_PREFIX        = 'erp:selector:stats:';
const PROMOTION_THRESHOLD = 20;   // consecutive successes to promote
const DEMOTION_THRESHOLD  = 20;   // consecutive failures to demote
const CONFIDENCE_DECAY    = 0.05; // 5% per hour
const TTL_SECS            = 7 * 24 * 3600; // 7-day persistence

class AdaptiveSelectorOptimizer {
    constructor() {
        this._localStats = new Map(); // selectorKey → { depths: { depthIdx: { wins, losses, streak } } }
        this._ordering   = new Map(); // selectorKey → number[] (preferred order of chain indices)
    }

    /**
     * Record the outcome of a selector resolution attempt.
     *
     * @param {string} selectorKey - Key from ERP_SELECTORS (e.g., 'LOGIN_USERNAME')
     * @param {number} depth       - Which fallback depth succeeded (0 = primary)
     * @param {boolean} success    - Did this selector succeed?
     * @param {string} [pageName]
     */
    async recordOutcome(selectorKey, depth, success, pageName = 'unknown') {
        const stats = await this._loadStats(selectorKey);
        if (!stats.depths[depth]) {
            stats.depths[depth] = { wins: 0, losses: 0, streak: 0, confidence: 100, lastUsed: Date.now() };
        }

        const d = stats.depths[depth];
        if (success) {
            d.wins++;
            d.streak = Math.max(0, d.streak) + 1;
            d.confidence = Math.min(100, d.confidence + 2);
        } else {
            d.losses++;
            d.streak = Math.min(0, d.streak) - 1;
            d.confidence = Math.max(0, d.confidence - 5);
        }
        d.lastUsed = Date.now();

        await this._saveStats(selectorKey, stats);

        // Check if promotion/demotion is needed
        if (depth > 0 && d.streak >= PROMOTION_THRESHOLD) {
            await this._promoteSelector(selectorKey, depth);
        }
        if (depth === 0 && d.streak <= -DEMOTION_THRESHOLD) {
            await this._demoteSelector(selectorKey);
        }

        this._emitMetrics(selectorKey, depth, success);
    }

    /**
     * Get the optimized selector chain for a key (may differ from static ERP_SELECTORS).
     *
     * @param {string} selectorKey
     * @returns {Promise<string[]>} Reordered selector chain
     */
    async getOptimizedChain(selectorKey) {
        const original = ERP_SELECTORS[selectorKey];
        if (!original) return [];

        const ordering = this._ordering.get(selectorKey);
        if (!ordering) return original;

        // Return chain reordered by current preference
        const reordered = ordering
            .filter(idx => idx < original.length)
            .map(idx => original[idx]);

        // Append any selectors not in the ordering
        for (let i = 0; i < original.length; i++) {
            if (!ordering.includes(i)) reordered.push(original[i]);
        }

        return reordered;
    }

    /**
     * Get confidence scores for all depths of a selector key.
     *
     * @param {string} selectorKey
     * @returns {Promise<object>}
     */
    async getConfidenceReport(selectorKey) {
        const stats    = await this._loadStats(selectorKey);
        const original = ERP_SELECTORS[selectorKey] || [];

        return {
            selectorKey,
            totalDepths: original.length,
            depths: Object.entries(stats.depths).map(([depth, data]) => ({
                depth:      parseInt(depth),
                selector:   original[depth] || 'unknown',
                confidence: data.confidence,
                wins:       data.wins,
                losses:     data.losses,
                streak:     data.streak
            })).sort((a, b) => a.depth - b.depth)
        };
    }

    /**
     * Reset all learned ordering (use after DOMDriftDetector confirms full reset).
     *
     * @param {string} [selectorKey] - Specific key or all keys if omitted
     */
    async resetOptimization(selectorKey) {
        if (selectorKey) {
            this._ordering.delete(selectorKey);
            this._localStats.delete(selectorKey);
            await this._deleteStats(selectorKey);
            logger.info(`[SelectorOptimizer] Reset optimization for "${selectorKey}"`);
        } else {
            this._ordering.clear();
            this._localStats.clear();
            logger.info('[SelectorOptimizer] Full optimization reset');
        }
    }

    // ─── Private ──────────────────────────────────────────────────────────────

    async _promoteSelector(selectorKey, depth) {
        logger.warn(`[SelectorOptimizer] PROMOTING selector depth ${depth} for "${selectorKey}" (succeeded ${PROMOTION_THRESHOLD} times consecutively)`);

        // Move depth to front of ordering
        let ordering = this._ordering.get(selectorKey) || Array.from({ length: (ERP_SELECTORS[selectorKey] || []).length }, (_, i) => i);
        ordering = ordering.filter(i => i !== depth);
        ordering.unshift(depth);
        this._ordering.set(selectorKey, ordering);

        try {
            const m = require('../../telemetry/ProviderMetrics');
            m.recordSelectorPromotion('sitam-scraper', selectorKey, depth);
        } catch (_) {}
    }

    async _demoteSelector(selectorKey) {
        logger.warn(`[SelectorOptimizer] DEMOTING primary selector for "${selectorKey}" (failed ${DEMOTION_THRESHOLD} times consecutively)`);

        // Move depth 0 to end of ordering
        const len      = (ERP_SELECTORS[selectorKey] || []).length;
        let ordering   = this._ordering.get(selectorKey) || Array.from({ length: len }, (_, i) => i);
        ordering       = ordering.filter(i => i !== 0);
        ordering.push(0);
        this._ordering.set(selectorKey, ordering);
    }

    async _loadStats(key) {
        try {
            if (redisService.isAlive()) {
                const raw = await redisService.client.get(`${REDIS_PREFIX}${key}`);
                if (raw) return JSON.parse(raw);
            }
        } catch (_) {}
        return this._localStats.get(key) || { depths: {} };
    }

    async _saveStats(key, stats) {
        this._localStats.set(key, stats);
        try {
            if (redisService.isAlive()) {
                await redisService.client.set(`${REDIS_PREFIX}${key}`, JSON.stringify(stats), 'EX', TTL_SECS);
            }
        } catch (_) {}
    }

    async _deleteStats(key) {
        this._localStats.delete(key);
        try {
            if (redisService.isAlive()) await redisService.client.del(`${REDIS_PREFIX}${key}`);
        } catch (_) {}
    }

    _emitMetrics(selectorKey, depth, success) {
        try {
            const m = require('../../telemetry/ProviderMetrics');
            m.recordSelectorFallbackDepth('sitam-scraper', selectorKey, depth);
            if (!success) m.recordSelectorFailure('sitam-scraper', selectorKey, 'unknown');
        } catch (_) {}
    }
}

module.exports = new AdaptiveSelectorOptimizer();
