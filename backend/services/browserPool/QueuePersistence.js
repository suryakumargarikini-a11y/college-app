'use strict';

/**
 * QueuePersistence — Redis-Backed Job Survival Across Restarts
 *
 * Problem: If the server crashes while jobs are waiting in the in-memory
 * BrowserPool priority queue, those pending requests are lost silently.
 * Students must re-login or trigger another sync manually.
 *
 * Solution: Before a job enters the priority queue, persist its metadata
 * to Redis using a sorted set (score = priority × 10^13 + timestamp).
 * On server restart, restore all pending jobs from Redis so they can be
 * re-enqueued into the new pool.
 *
 * Redis Key: sitam:browserpool:pending
 *
 * Note: BullMQ already handles persistence for the main sync queue.
 * This layer targets only browser-pool-level job metadata (the pre-scrape
 * queue that gates access to a Chromium context).
 *
 * @module QueuePersistence
 */

const logger = require('../logger');

const REDIS_KEY = 'sitam:browserpool:pending';

class QueuePersistence {
    constructor() {
        /** @type {import('ioredis').Redis|null} */
        this._redis = null;
    }

    // ─── Public API ───────────────────────────────────────────────────────────

    /**
     * Persist a job entry to Redis before it enters the in-memory queue.
     * Silent no-op if Redis is unavailable.
     *
     * @param {Object} job
     * @param {string} job.id       - Unique job identifier
     * @param {string} job.jobType  - e.g. 'LOGIN', 'ATTENDANCE'
     * @param {string} [job.userId] - Student ID for affinity/logging
     * @param {number} job.priority - JOB_PRIORITY value
     * @param {Object} [job.payload] - Optional extra context
     */
    async persist(job) {
        const redis = this._client();
        if (!redis) return;

        try {
            // Score encodes priority (leading digits) + timestamp (trailing digits)
            // so zadd WITHSCORES gives a natural priority-then-FIFO ordering.
            const score = job.priority * 1e13 + Date.now();
            await redis.zadd(REDIS_KEY, score, JSON.stringify(job));
        } catch (err) {
            logger.warn(`[QueuePersistence] persist failed for job ${job.id}: ${err.message}`);
        }
    }

    /**
     * Remove a job from the persisted set once it is complete (success or failure).
     * Silent no-op if Redis is unavailable.
     *
     * @param {string} jobId
     */
    async complete(jobId) {
        const redis = this._client();
        if (!redis) return;

        try {
            // Scan all members to find by jobId — the set is typically small
            const members = await redis.zrange(REDIS_KEY, 0, -1);
            for (const member of members) {
                let parsed;
                try { parsed = JSON.parse(member); } catch (_) { continue; }
                if (parsed.id === jobId) {
                    await redis.zrem(REDIS_KEY, member);
                    break;
                }
            }
        } catch (err) {
            logger.warn(`[QueuePersistence] complete failed for job ${jobId}: ${err.message}`);
        }
    }

    /**
     * Load all pending jobs from Redis on server startup.
     * Jobs are returned sorted by priority then timestamp (lowest score first).
     *
     * @returns {Promise<Object[]>} Sorted array of job objects
     */
    async restore() {
        const redis = this._client();
        if (!redis) return [];

        try {
            const members = await redis.zrange(REDIS_KEY, 0, -1);
            const jobs = [];
            for (const member of members) {
                try { jobs.push(JSON.parse(member)); } catch (_) {}
            }
            if (jobs.length > 0) {
                logger.info(`[QueuePersistence] Restored ${jobs.length} pending job(s) from Redis.`);
            }
            return jobs;
        } catch (err) {
            logger.warn(`[QueuePersistence] restore failed: ${err.message}`);
            return [];
        }
    }

    /**
     * Clear the entire persisted set.
     * Called on graceful shutdown so stale jobs don't re-appear on next boot.
     */
    async clear() {
        const redis = this._client();
        if (!redis) return;
        try { await redis.del(REDIS_KEY); } catch (_) {}
    }

    // ─── Private ──────────────────────────────────────────────────────────────

    /** Lazy Redis client accessor — avoids circular dep at module load time. */
    _client() {
        if (!this._redis) {
            try {
                const rs = require('../redisService');
                this._redis = rs.client || null;
            } catch (_) {}
        }
        return this._redis;
    }
}

module.exports = new QueuePersistence();
