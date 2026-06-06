/**
 * SITAM Smart ERP — ERP Maintenance Mode Detector
 *
 * Detects ERP maintenance pages, downtime notices, and lockdown windows.
 * When maintenance is detected:
 *   1. All low-priority syncs are paused globally
 *   2. Destructive retries are suppressed
 *   3. Queue concurrency is reduced to 0 for non-critical jobs
 *   4. Maintenance TTL window is stored in Redis
 *
 * MAINTENANCE SEVERITY:
 *   MINOR      — Brief message, syncs continue with backoff
 *   DEGRADED   — Intermittent outage, reduce concurrency
 *   DOWN       — Full outage, pause all non-critical syncs
 *   LOCKDOWN   — Exam/result freeze, complete sync suspension
 */

'use strict';

const logger       = require('../../../services/logger');
const redisService = require('../../../services/redisService');

const REDIS_KEY         = 'erp:maintenance:state';
const MAINTENANCE_TTL   = 30 * 60; // 30-minute default maintenance window TTL

const MAINTENANCE_PATTERNS = [
    'site is under maintenance', 'system maintenance', 'scheduled maintenance',
    "we'll be back soon", 'temporarily unavailable', 'erp unavailable',
    'down for maintenance', 'undergoing maintenance', 'service unavailable',
    'please try again later', 'system is currently unavailable',
    'maintenance window', 'site will be back', 'exam result freeze',
    'result processing', 'server overload', 'high traffic', 'try after some time',
    '503 service unavailable', '503 error', 'gateway timeout', '502 bad gateway',
    'site not available', 'database maintenance'
];

const SEVERITY_MAP = {
    LOCKDOWN:  ['exam result freeze', 'result processing', 'university maintenance'],
    DOWN:      ['503', '502', 'site not available', 'database maintenance', 'completely unavailable'],
    DEGRADED:  ['high traffic', 'server overload', 'service unavailable', 'temporarily unavailable'],
    MINOR:     ['maintenance', 'try again later', "we'll be back"]
};

class ERPMaintenanceDetector {
    constructor() {
        this._localState    = null;
        this._localStateExp = 0;
    }

    /**
     * Detect maintenance mode from a Puppeteer page.
     * Call this after login or any page navigation failure.
     *
     * @param {import('puppeteer').Page} page
     * @param {string} [html] - Pre-fetched HTML
     * @returns {Promise<{ detected: boolean, severity: string, message: string, estimatedDownMs: number }>}
     */
    async detect(page, html) {
        try {
            const pageHtml  = html || await page.content();
            const lower     = pageHtml.toLowerCase();
            const pageUrl   = page.url();

            // Check HTTP error indicators in URL
            if (pageUrl.includes('/error/503') || pageUrl.includes('/error/502')) {
                return this._buildResult(true, 'DOWN', 'HTTP 5xx error page', 30 * 60 * 1000);
            }

            // Scan for maintenance patterns
            for (const pattern of MAINTENANCE_PATTERNS) {
                if (lower.includes(pattern)) {
                    const severity      = this._classifySeverity(pattern);
                    const estimatedDown = this._estimateDowntime(severity);
                    const result        = this._buildResult(true, severity, `Matched: "${pattern}"`, estimatedDown);

                    await this._storeMaintenance(result);
                    logger.warn(`[MaintenanceDetector] MAINTENANCE detected — severity: ${severity}, pattern: "${pattern}"`);
                    this._recordMetrics(severity);

                    return result;
                }
            }

            // HTTP status check via page.evaluate
            try {
                const title = await page.evaluate(() => document.title || '');
                if (title.toLowerCase().includes('503') || title.toLowerCase().includes('maintenance')) {
                    return this._buildResult(true, 'DOWN', `Page title: "${title}"`, 30 * 60 * 1000);
                }
            } catch (_) {}

            return { detected: false, severity: null, message: null, estimatedDownMs: 0 };

        } catch (err) {
            logger.debug(`[MaintenanceDetector] Detection error (non-fatal): ${err.message}`);
            return { detected: false, severity: null, message: null, estimatedDownMs: 0 };
        }
    }

    /**
     * Check if ERP is currently in a stored maintenance window.
     * (Persists across requests — once detected, suppression is global for TTL period.)
     *
     * @returns {Promise<boolean>}
     */
    async isInMaintenanceWindow() {
        // Check local cache first
        if (this._localState && Date.now() < this._localStateExp) {
            return true;
        }

        try {
            if (redisService.isAlive()) {
                const raw = await redisService.client.get(REDIS_KEY);
                if (raw) {
                    const state = JSON.parse(raw);
                    this._localState    = state;
                    this._localStateExp = new Date(state.expiresAt).getTime();
                    return true;
                }
            }
        } catch (_) {}

        this._localState = null;
        return false;
    }

    /**
     * Get the current maintenance state (for Grafana/health endpoints).
     *
     * @returns {Promise<object|null>}
     */
    async getMaintenanceState() {
        try {
            if (redisService.isAlive()) {
                const raw = await redisService.client.get(REDIS_KEY);
                return raw ? JSON.parse(raw) : null;
            }
        } catch (_) {}
        return this._localState;
    }

    /**
     * Manually clear maintenance state (call when ERP is confirmed back online).
     */
    async clearMaintenance() {
        this._localState    = null;
        this._localStateExp = 0;
        try {
            if (redisService.isAlive()) await redisService.client.del(REDIS_KEY);
        } catch (_) {}
        logger.info('[MaintenanceDetector] Maintenance state cleared manually');
    }

    /**
     * Should syncs be suppressed for this priority level during current maintenance?
     *
     * @param {string} priority - 'critical'|'high'|'medium'|'low'
     * @returns {Promise<boolean>}
     */
    async shouldSuppressSync(priority) {
        const state = await this.getMaintenanceState();
        if (!state) return false;

        switch (state.severity) {
            case 'LOCKDOWN':  return true;                        // All syncs suppressed
            case 'DOWN':      return priority !== 'critical';     // Only critical passes
            case 'DEGRADED':  return priority === 'low';          // Low priority suppressed
            case 'MINOR':     return false;                       // All syncs continue
            default:          return false;
        }
    }

    // ─── Private ──────────────────────────────────────────────────────────────

    _classifySeverity(pattern) {
        for (const [severity, patterns] of Object.entries(SEVERITY_MAP)) {
            if (patterns.some(p => pattern.includes(p))) return severity;
        }
        return 'MINOR';
    }

    _estimateDowntime(severity) {
        const estimates = { LOCKDOWN: 4 * 3600 * 1000, DOWN: 60 * 60 * 1000, DEGRADED: 20 * 60 * 1000, MINOR: 10 * 60 * 1000 };
        return estimates[severity] || 15 * 60 * 1000;
    }

    _buildResult(detected, severity, message, estimatedDownMs) {
        return { detected, severity, message, estimatedDownMs,
                 detectedAt: new Date().toISOString(),
                 expiresAt:  new Date(Date.now() + estimatedDownMs).toISOString() };
    }

    async _storeMaintenance(result) {
        const ttlSecs = Math.max(60, Math.floor(result.estimatedDownMs / 1000));
        this._localState    = result;
        this._localStateExp = Date.now() + result.estimatedDownMs;

        try {
            if (redisService.isAlive()) {
                await redisService.client.set(REDIS_KEY, JSON.stringify(result), 'EX', ttlSecs);
            }
        } catch (_) {}
    }

    _recordMetrics(severity) {
        try {
            const m = require('../../telemetry/ProviderMetrics');
            m.recordMaintenanceMode('sitam-scraper', severity);
        } catch (_) {}
    }
}

module.exports = new ERPMaintenanceDetector();
