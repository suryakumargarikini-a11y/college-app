/**
 * SITAM Smart ERP — Provider Session Manager
 *
 * Abstraction layer over the low-level sessionManager.js.
 * Manages ERP session lifecycle with:
 *   - TTL-aware session storage (Redis primary / in-memory fallback)
 *   - Provider-tagged sessions (scraper vs api)
 *   - Session health scoring
 *   - Auto-expiry enforcement
 *
 * DESIGN: This lives inside the provider boundary — services never
 * touch sessions directly, only through the provider's syncStudent/syncIncremental.
 */

'use strict';

const logger = require('../../services/logger');
const redisService = require('../../services/redisService');

// Session TTL: 25 minutes (ERP sessions typically expire at 30 min of inactivity)
const DEFAULT_SESSION_TTL_MS = 25 * 60 * 1000;
const REDIS_SESSION_PREFIX = 'provider:session:';

class ProviderSessionManager {
    constructor() {
        // In-memory fallback when Redis is unavailable
        this._localSessions = new Map();
    }

    /**
     * Retrieve an active session for a student.
     * Returns null if no session exists or if it has expired.
     *
     * @param {string} userId
     * @returns {Promise<{ cookies: string, expiresAt: Date, provider: string } | null>}
     */
    async acquire(userId) {
        try {
            if (redisService.isAlive()) {
                const raw = await redisService.client.get(`${REDIS_SESSION_PREFIX}${userId}`);
                if (raw) {
                    const session = JSON.parse(raw);
                    if (new Date(session.expiresAt) > new Date()) {
                        logger.info(`[ProviderSession] Acquired active Redis session for ${userId} (provider: ${session.provider})`);
                        return session;
                    }
                    // Expired — clean up
                    await redisService.client.del(`${REDIS_SESSION_PREFIX}${userId}`);
                }
            } else {
                // Fallback: in-memory
                const session = this._localSessions.get(userId);
                if (session && new Date(session.expiresAt) > new Date()) {
                    logger.info(`[ProviderSession] Acquired active in-memory session for ${userId}`);
                    return session;
                }
                this._localSessions.delete(userId);
            }
        } catch (err) {
            logger.warn(`[ProviderSession] Error acquiring session for ${userId}: ${err.message}`);
        }
        return null;
    }

    /**
     * Store a new or refreshed session for a student.
     *
     * @param {string} userId
     * @param {{ cookies: string, provider: string, studentName?: string }} sessionData
     * @param {number} [ttlMs] - TTL in milliseconds (default: 25 minutes)
     * @returns {Promise<void>}
     */
    async store(userId, sessionData, ttlMs = DEFAULT_SESSION_TTL_MS) {
        const expiresAt = new Date(Date.now() + ttlMs);
        const record = {
            userId,
            cookies:     sessionData.cookies,
            provider:    sessionData.provider || 'scraper',
            studentName: sessionData.studentName || userId,
            storedAt:    new Date().toISOString(),
            expiresAt:   expiresAt.toISOString(),
            lastUsed:    new Date().toISOString()
        };

        try {
            if (redisService.isAlive()) {
                await redisService.client.set(
                    `${REDIS_SESSION_PREFIX}${userId}`,
                    JSON.stringify(record),
                    'PX', ttlMs
                );
                logger.info(`[ProviderSession] Stored session in Redis for ${userId} (TTL: ${Math.round(ttlMs/60000)}min, provider: ${record.provider})`);
            } else {
                this._localSessions.set(userId, record);
                // Schedule local expiry cleanup
                setTimeout(() => this._localSessions.delete(userId), ttlMs);
                logger.info(`[ProviderSession] Stored session in memory for ${userId} (TTL: ${Math.round(ttlMs/60000)}min)`);
            }
        } catch (err) {
            logger.warn(`[ProviderSession] Error storing session for ${userId}: ${err.message}`);
            // Always store locally as fallback
            this._localSessions.set(userId, record);
        }
    }

    /**
     * Update the lastUsed timestamp to extend session activity window.
     *
     * @param {string} userId
     * @returns {Promise<void>}
     */
    async touch(userId) {
        try {
            if (redisService.isAlive()) {
                const raw = await redisService.client.get(`${REDIS_SESSION_PREFIX}${userId}`);
                if (raw) {
                    const session = JSON.parse(raw);
                    session.lastUsed = new Date().toISOString();
                    const remainingTtl = await redisService.client.pttl(`${REDIS_SESSION_PREFIX}${userId}`);
                    if (remainingTtl > 0) {
                        await redisService.client.set(
                            `${REDIS_SESSION_PREFIX}${userId}`,
                            JSON.stringify(session),
                            'PX', remainingTtl
                        );
                    }
                }
            } else {
                const session = this._localSessions.get(userId);
                if (session) session.lastUsed = new Date().toISOString();
            }
        } catch (err) {
            logger.warn(`[ProviderSession] Error touching session for ${userId}: ${err.message}`);
        }
    }

    /**
     * Invalidate (delete) a student's session immediately.
     *
     * @param {string} userId
     * @returns {Promise<void>}
     */
    async invalidate(userId) {
        try {
            if (redisService.isAlive()) {
                await redisService.client.del(`${REDIS_SESSION_PREFIX}${userId}`);
            }
            this._localSessions.delete(userId);
            logger.info(`[ProviderSession] Session invalidated for ${userId}`);
        } catch (err) {
            logger.warn(`[ProviderSession] Error invalidating session for ${userId}: ${err.message}`);
        }
    }

    /**
     * Check if a valid session exists for a student (non-destructive).
     *
     * @param {string} userId
     * @returns {Promise<boolean>}
     */
    async hasValidSession(userId) {
        const session = await this.acquire(userId);
        return session !== null;
    }

    /**
     * Get all active session user IDs (for sync queue tick).
     * Returns up to 200 entries to avoid memory pressure.
     *
     * @returns {Promise<string[]>}
     */
    async getActiveSessions() {
        const userIds = [];
        try {
            if (redisService.isAlive()) {
                const keys = await redisService.client.keys(`${REDIS_SESSION_PREFIX}*`);
                return keys.map(k => k.replace(REDIS_SESSION_PREFIX, '')).slice(0, 200);
            } else {
                for (const [userId, session] of this._localSessions.entries()) {
                    if (new Date(session.expiresAt) > new Date()) {
                        userIds.push(userId);
                    }
                }
            }
        } catch (err) {
            logger.warn(`[ProviderSession] Error listing sessions: ${err.message}`);
        }
        return userIds.slice(0, 200);
    }
}

// Export a singleton — one session manager per process
module.exports = new ProviderSessionManager();
