/**
 * Academic Module V2 - Cache Management Layer
 * 
 * Manages performance caching for student academic results.
 */

const cacheService = require('../../services/cacheService');
const logger = require('../../services/logger');

const NAMESPACE = 'academic_results';
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24 Hours

class AcademicCache {
    /**
     * Get cached academic results for student.
     * @param {string} userId 
     * @returns {Promise<import('./academic.types').AcademicHistoryDTO|null>}
     */
    async get(userId) {
        if (!userId) return null;
        try {
            const cached = await cacheService.get(NAMESPACE, userId);
            if (cached && Array.isArray(cached.semesters) && cached.semesters.length > 0) {
                logger.info(`[AcademicCache] Cache HIT for student ${userId}`);
                return cached;
            }
        } catch (err) {
            logger.warn(`[AcademicCache] Error reading cache for ${userId}: ${err.message}`);
        }
        return null;
    }

    /**
     * Set cached academic results for student.
     * @param {string} userId 
     * @param {import('./academic.types').AcademicHistoryDTO} payload 
     * @param {number} [ttlMs] 
     * @returns {Promise<boolean>}
     */
    async set(userId, payload, ttlMs = DEFAULT_TTL_MS) {
        if (!userId || !payload) return false;
        try {
            cacheService.set(NAMESPACE, userId, payload, ttlMs);
            logger.info(`[AcademicCache] Cached results for student ${userId} (${payload.semesters ? payload.semesters.length : 0} semesters)`);
            return true;
        } catch (err) {
            logger.warn(`[AcademicCache] Error writing cache for ${userId}: ${err.message}`);
            return false;
        }
    }

    /**
     * Invalidate cache entry for student.
     * @param {string} userId 
     */
    invalidate(userId) {
        if (!userId) return;
        try {
            cacheService.invalidate(NAMESPACE, userId);
            logger.info(`[AcademicCache] Invalidated cache for student ${userId}`);
        } catch (err) {
            logger.warn(`[AcademicCache] Error invalidating cache for ${userId}: ${err.message}`);
        }
    }
}

module.exports = new AcademicCache();
