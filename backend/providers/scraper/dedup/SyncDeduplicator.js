/**
 * SITAM Smart ERP — Sync Deduplication Engine
 *
 * Provides distributed locking to prevent duplicate concurrent syncs for
 * the same student. Wraps and extends the existing BullMQ jobId dedup
 * and workerService Redis lock pattern.
 *
 * DEDUP LAYERS:
 *   Layer 1: BullMQ jobId `sync:${userId}` — deduplicates queue entries
 *   Layer 2: Redis NX lock `lock:sync:${userId}` — prevents concurrent workers
 *   Layer 3: SyncDeduplicator (this) — higher-level dedup with metrics tracking
 *
 * FALLBACK: In-memory Set when Redis is unavailable.
 */

'use strict';

const logger       = require('../../../services/logger');
const redisService = require('../../../services/redisService');

const LOCK_PREFIX   = 'dedup:sync:';
const DEFAULT_TTL_MS = parseInt(process.env.SYNC_LOCK_TTL_MS || '120000', 10); // 2 min

class SyncDeduplicator {
    constructor() {
        this._memoryLocks   = new Set();
        this._lockTimers    = new Map();
        this._dedupHits     = 0;
        this._lockContention = 0;
    }

    /**
     * Attempt to acquire a distributed sync lock for a student.
     * Returns true if lock acquired, false if another sync is already running.
     *
     * @param {string} userId
     * @param {number} [ttlMs]
     * @param {string} [requestId]
     * @returns {Promise<boolean>}
     */
    async acquireLock(userId, ttlMs = DEFAULT_TTL_MS, requestId = 'unknown') {
        const key = `${LOCK_PREFIX}${userId}`;

        try {
            if (redisService.isAlive()) {
                const acquired = await redisService.client.set(key, requestId, 'NX', 'PX', ttlMs);
                if (!acquired) {
                    this._dedupHits++;
                    this._recordMetrics('dedup_hit', userId);
                    logger.info(`[SyncDedup] Lock DENIED for ${userId} — sync already in progress`);
                    return false;
                }
                logger.debug(`[SyncDedup] Lock ACQUIRED for ${userId} (TTL: ${Math.round(ttlMs/1000)}s)`);
                return true;
            }
        } catch (redisErr) {
            logger.warn(`[SyncDedup] Redis lock failed, using memory fallback: ${redisErr.message}`);
        }

        // Fallback: in-memory lock
        if (this._memoryLocks.has(userId)) {
            this._dedupHits++;
            this._recordMetrics('dedup_hit_memory', userId);
            return false;
        }

        this._memoryLocks.add(userId);
        const timer = setTimeout(() => {
            this._memoryLocks.delete(userId);
            this._lockTimers.delete(userId);
        }, ttlMs);
        this._lockTimers.set(userId, timer);
        return true;
    }

    /**
     * Explicitly release a sync lock (call on sync completion or failure).
     *
     * @param {string} userId
     */
    async releaseLock(userId) {
        const key = `${LOCK_PREFIX}${userId}`;

        try {
            if (redisService.isAlive()) {
                await redisService.client.del(key);
            }
        } catch (_) {}

        // Also clear memory lock
        this._memoryLocks.delete(userId);
        if (this._lockTimers.has(userId)) {
            clearTimeout(this._lockTimers.get(userId));
            this._lockTimers.delete(userId);
        }

        logger.debug(`[SyncDedup] Lock RELEASED for ${userId}`);
    }

    /**
     * Non-blocking check: is a sync currently locked for this user?
     */
    async isLocked(userId) {
        const key = `${LOCK_PREFIX}${userId}`;
        try {
            if (redisService.isAlive()) {
                const val = await redisService.client.get(key);
                return val !== null;
            }
        } catch (_) {}
        return this._memoryLocks.has(userId);
    }

    /**
     * Execute a sync function with automatic lock acquisition and release.
     * Returns null if lock could not be acquired (another sync running).
     *
     * @param {string} userId
     * @param {Function} fn - Async function to execute while holding lock
     * @param {object} [opts]
     * @returns {Promise<any|null>}
     */
    async withLock(userId, fn, opts = {}) {
        const ttlMs     = opts.ttlMs     || DEFAULT_TTL_MS;
        const requestId = opts.requestId || 'unknown';

        const acquired = await this.acquireLock(userId, ttlMs, requestId);
        if (!acquired) {
            this._lockContention++;
            return null; // Caller handles the skip
        }

        try {
            return await fn();
        } finally {
            await this.releaseLock(userId);
        }
    }

    /**
     * Get deduplication stats for health/metrics.
     */
    getStats() {
        return {
            dedupHits:      this._dedupHits,
            lockContention: this._lockContention,
            activeLocks:    this._memoryLocks.size
        };
    }

    _recordMetrics(event, userId) {
        try {
            const m = require('../../telemetry/ProviderMetrics');
            m.recordSyncDedupHit('sitam-scraper');
        } catch (_) {}
    }
}

module.exports = new SyncDeduplicator();
