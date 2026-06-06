/**
 * SITAM Smart ERP — Partial Sync Recovery System
 *
 * Implements checkpoint-based resumable synchronization.
 * When a sync partially succeeds (e.g., profile+marks succeed but fees fail),
 * the checkpoint is stored. The next retry only re-runs the failed modules.
 *
 * Sync Modules (in priority order):
 *   profile → marks → attendance → fees → assignments
 *
 * STORAGE: Redis with 2-hour TTL → in-memory fallback
 *
 * USAGE:
 *   // In SITAMScraperProvider.syncStudent():
 *   for (const module of recoveryPlan) {
 *     try {
 *       const data = await this.scrapeModule(module, page);
 *       await recovery.saveCheckpoint(userId, module, 'done', data);
 *     } catch(err) {
 *       await recovery.saveCheckpoint(userId, module, 'failed', null);
 *     }
 *   }
 *   await recovery.clearCheckpoint(userId); // on full success
 */

'use strict';

const logger       = require('../../../services/logger');
const redisService = require('../../../services/redisService');

const REDIS_PREFIX  = 'sync:checkpoint:';
const CHECKPOINT_TTL_SECS = 2 * 60 * 60; // 2 hours
const ALL_MODULES   = ['profile', 'marks', 'fees', 'assignments'];

class PartialSyncRecovery {
    constructor() {
        this._localCache = new Map();
    }

    /**
     * Save the status of a sync module (called after each module attempt).
     *
     * @param {string} userId
     * @param {string} module    - 'profile'|'marks'|'fees'|'assignments'
     * @param {string} status    - 'done'|'failed'|'skipped'
     * @param {object|null} data - Scraped data (only stored locally for session)
     */
    async saveCheckpoint(userId, module, status, data = null) {
        const key = `${REDIS_PREFIX}${userId}`;
        let checkpoint = await this._load(userId) || { userId, modules: {}, startedAt: new Date().toISOString() };

        checkpoint.modules[module] = {
            status,
            updatedAt: new Date().toISOString(),
            hasData:   data !== null
        };
        checkpoint.lastUpdated = new Date().toISOString();

        // Store data reference in memory (not persisted to Redis — too large)
        if (data) {
            const memKey = `${userId}:${module}`;
            this._localCache.set(memKey, { data, storedAt: Date.now() });
        }

        await this._save(userId, checkpoint);
        logger.debug(`[PartialRecovery] ${userId}/${module}: ${status}`);
    }

    /**
     * Load the current checkpoint for a user.
     *
     * @param {string} userId
     * @returns {Promise<object|null>} Checkpoint or null if none exists
     */
    async loadCheckpoint(userId) {
        return this._load(userId);
    }

    /**
     * Get the recovery plan — list of modules that still need to run.
     * If no checkpoint exists, returns all modules (fresh sync).
     *
     * @param {string} userId
     * @returns {Promise<string[]>} Ordered list of modules to execute
     */
    async getRecoveryPlan(userId) {
        const checkpoint = await this._load(userId);
        if (!checkpoint) return [...ALL_MODULES];

        const remaining = ALL_MODULES.filter(module => {
            const status = checkpoint.modules[module]?.status;
            return status !== 'done'; // Re-run failed, skipped, or not-yet-started modules
        });

        if (remaining.length < ALL_MODULES.length) {
            const completed = ALL_MODULES.filter(m => checkpoint.modules[m]?.status === 'done');
            logger.info(`[PartialRecovery] ${userId}: resuming from checkpoint. Completed: [${completed.join(',')}]. Remaining: [${remaining.join(',')}]`);
            this._recordMetrics('resume', userId);
        }

        return remaining;
    }

    /**
     * Get previously scraped data for a module (from in-memory cache).
     * Returns null if data has expired or was not cached.
     *
     * @param {string} userId
     * @param {string} module
     * @returns {object|null}
     */
    getCachedData(userId, module) {
        const key     = `${userId}:${module}`;
        const entry   = this._localCache.get(key);
        if (!entry) return null;

        // Cache expires after 30 minutes
        if (Date.now() - entry.storedAt > 30 * 60 * 1000) {
            this._localCache.delete(key);
            return null;
        }

        return entry.data;
    }

    /**
     * Clear checkpoint on successful full sync.
     *
     * @param {string} userId
     */
    async clearCheckpoint(userId) {
        const key = `${REDIS_PREFIX}${userId}`;
        try {
            if (redisService.isAlive()) {
                await redisService.client.del(key);
            }
        } catch (_) {}

        // Clear local data cache for this user
        for (const module of ALL_MODULES) {
            this._localCache.delete(`${userId}:${module}`);
        }

        logger.debug(`[PartialRecovery] ${userId}: checkpoint cleared`);
    }

    /**
     * Check if a user has an in-progress partial checkpoint.
     */
    async hasPartialCheckpoint(userId) {
        const checkpoint = await this._load(userId);
        if (!checkpoint) return false;
        const values = Object.values(checkpoint.modules || {});
        return values.some(m => m.status === 'done') && values.some(m => m.status === 'failed');
    }

    /**
     * Get checkpoint summary for health/debug endpoints.
     */
    async getSummary(userId) {
        const checkpoint = await this._load(userId);
        if (!checkpoint) return { hasCheckpoint: false };

        const modules = checkpoint.modules || {};
        return {
            hasCheckpoint: true,
            startedAt:     checkpoint.startedAt,
            lastUpdated:   checkpoint.lastUpdated,
            completed:     Object.entries(modules).filter(([, v]) => v.status === 'done').map(([k]) => k),
            failed:        Object.entries(modules).filter(([, v]) => v.status === 'failed').map(([k]) => k),
            remaining:     ALL_MODULES.filter(m => modules[m]?.status !== 'done')
        };
    }

    // ─── Private ──────────────────────────────────────────────────────────────

    async _load(userId) {
        try {
            if (redisService.isAlive()) {
                const raw = await redisService.client.get(`${REDIS_PREFIX}${userId}`);
                if (raw) return JSON.parse(raw);
            }
        } catch (_) {}
        return this._localCache.get(`checkpoint:${userId}`) || null;
    }

    async _save(userId, checkpoint) {
        try {
            if (redisService.isAlive()) {
                await redisService.client.set(
                    `${REDIS_PREFIX}${userId}`,
                    JSON.stringify(checkpoint),
                    'EX', CHECKPOINT_TTL_SECS
                );
                return;
            }
        } catch (_) {}
        this._localCache.set(`checkpoint:${userId}`, checkpoint);
    }

    _recordMetrics(event, userId) {
        try {
            const m = require('../../telemetry/ProviderMetrics');
            m.recordPartialSyncRecovery('sitam-scraper', event);
        } catch (_) {}
    }
}

module.exports = new PartialSyncRecovery();
