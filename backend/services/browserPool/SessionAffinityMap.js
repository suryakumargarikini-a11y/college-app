'use strict';

/**
 * SessionAffinityMap — Student → Browser Affinity Tracker
 *
 * When a student triggers a sync shortly after a previous one,
 * prefer routing to the same browser so its incognito context
 * may still hold warm cookies — reducing the need for a full ERP re-login.
 *
 * TTL: SESSION_AFFINITY_TTL_MS (default 10 minutes)
 * Cleanup: runs every 5 minutes to remove expired entries
 *
 * This is a best-effort hint to BrowserPool.acquire().
 * If the affine browser is busy or retired, the pool falls back
 * to any available idle browser without any degradation.
 *
 * @module SessionAffinityMap
 */

const AFFINITY_TTL_MS = parseInt(
    process.env.SESSION_AFFINITY_TTL_MS || String(10 * 60 * 1000),
    10
);
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

class SessionAffinityMap {
    constructor() {
        /**
         * @type {Map<string, { browserId: string, expiresAt: number }>}
         */
        this._map = new Map();

        // Periodic cleanup — runs on a non-blocking timer
        this._cleanupTimer = setInterval(() => this._cleanup(), CLEANUP_INTERVAL_MS);
        if (typeof this._cleanupTimer.unref === 'function') {
            this._cleanupTimer.unref(); // don't prevent process exit
        }
    }

    /**
     * Record that a student successfully used a browser.
     * Call this after a successful job checkout.
     *
     * @param {string} userId    - Student / user identifier
     * @param {string} browserId - BrowserInstance.id
     */
    record(userId, browserId) {
        this._map.set(userId, {
            browserId,
            expiresAt: Date.now() + AFFINITY_TTL_MS,
        });
    }

    /**
     * Get the preferred browserId for a student.
     * Returns null if no entry exists or the entry has expired.
     *
     * @param {string} userId
     * @returns {string|null}
     */
    get(userId) {
        const entry = this._map.get(userId);
        if (!entry) return null;
        if (Date.now() > entry.expiresAt) {
            this._map.delete(userId);
            return null;
        }
        return entry.browserId;
    }

    /**
     * Explicitly evict a student's affinity.
     * Called when a browser is recycled or crashes so we don't route
     * future requests to a dead browser.
     *
     * @param {string} browserId - Evict ALL students whose affinity points here
     */
    evictBrowser(browserId) {
        for (const [userId, entry] of this._map) {
            if (entry.browserId === browserId) {
                this._map.delete(userId);
            }
        }
    }

    /**
     * Remove a specific student's affinity.
     * @param {string} userId
     */
    clear(userId) {
        this._map.delete(userId);
    }

    /**
     * Stop the cleanup interval (called on pool shutdown).
     */
    destroy() {
        clearInterval(this._cleanupTimer);
        this._map.clear();
    }

    /**
     * Returns current stats for diagnostics.
     */
    getStats() {
        return {
            activeAffinities: this._map.size,
            ttlMs: AFFINITY_TTL_MS,
        };
    }

    // ─── Private ──────────────────────────────────────────────────────────────

    _cleanup() {
        const now = Date.now();
        let removed = 0;
        for (const [userId, entry] of this._map) {
            if (now > entry.expiresAt) {
                this._map.delete(userId);
                removed++;
            }
        }
        if (removed > 0) {
            // Lazy logger import to avoid circular dep during module init
            try {
                require('../logger').info(
                    `[SessionAffinity] Pruned ${removed} expired session affinity entries. ` +
                    `Remaining: ${this._map.size}`
                );
            } catch (_) {}
        }
    }
}

// Singleton — shared across AUTH_POOL and SYNC_POOL
module.exports = new SessionAffinityMap();
