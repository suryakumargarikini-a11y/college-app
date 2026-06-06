/**
 * SITAM Smart ERP — DOM Drift Detector
 *
 * Detects ERP HTML structural changes (redesigns, rebrands, navigation changes)
 * BEFORE they cause large-scale sync failures across many students.
 *
 * HOW IT WORKS:
 *   1. On first successful scrape of a page, a "baseline fingerprint" is stored.
 *   2. On every subsequent scrape, a new fingerprint is computed and diffed.
 *   3. If the drift score exceeds thresholds, alerts are raised.
 *
 * STORAGE:
 *   - Redis: baseline fingerprints per page (with 30-day TTL)
 *   - Fallback: JSON file at backend/data/baselines.json
 *
 * DRIFT SCORE:
 *   0–5   = Negligible  (normal content variation)
 *   6–25  = Minor       (cosmetic changes, log warning)
 *   26–60 = Major       (structural change, raise SelectorDriftError alert)
 *   61–100= Critical    (full redesign, suspend syncs, page-down alert)
 */

'use strict';

const crypto   = require('crypto');
const fs       = require('fs');
const path     = require('path');
const logger   = require('../../../services/logger');
const redisService = require('../../../services/redisService');
const { SelectorDriftError } = require('../../errors');

const REDIS_PREFIX        = 'erp:dom:baseline:';
const BASELINE_TTL_DAYS   = 30;
const BASELINE_TTL_SECS   = BASELINE_TTL_DAYS * 24 * 3600;
const FALLBACK_FILE       = path.join(__dirname, '../../../data/dom_baselines.json');

const DRIFT_THRESHOLDS = {
    NEGLIGIBLE: 5,
    MINOR:      25,
    MAJOR:      60,
    CRITICAL:   100
};

class DOMDriftDetector {
    constructor() {
        this._localCache = new Map();
    }

    /**
     * Generate a structural fingerprint of a page's HTML.
     * Does NOT store raw HTML — only structural metrics.
     *
     * @param {string} html - Full page HTML or content div HTML
     * @param {string} pageName - 'login'|'profile'|'marks'|'fees'|'assignments'
     * @returns {object} Fingerprint object
     */
    fingerprint(html, pageName) {
        if (!html || html.length < 100) {
            return this._emptyFingerprint(pageName);
        }

        // Simple but fast pattern counting (avoids full DOM parse)
        const fp = {
            page:           pageName,
            htmlLength:     html.length,
            tableCount:     (html.match(/<table/gi) || []).length,
            formCount:      (html.match(/<form/gi) || []).length,
            inputCount:     (html.match(/<input/gi) || []).length,
            selectCount:    (html.match(/<select/gi) || []).length,
            linkCount:      (html.match(/<a\s/gi) || []).length,
            h1Count:        (html.match(/<h1/gi) || []).length,
            h2Count:        (html.match(/<h2/gi) || []).length,
            tdCount:        (html.match(/<td/gi) || []).length,
            thCount:        (html.match(/<th/gi) || []).length,
            divCount:       (html.match(/<div/gi) || []).length,
            spanCount:      (html.match(/<span/gi) || []).length,
            // Check for known structural markers
            hasAspNetForm:  html.includes('runat="server"') || html.includes('__VIEWSTATE'),
            hasLoginForm:   html.includes('txtId2') || html.includes('txtPwd2'),
            hasTableData:   html.includes('<td') && html.includes('<tr'),
            // Structural hash (first 2KB of HTML for stability)
            structuralHash: crypto.createHash('md5').update(html.slice(0, 2048)).digest('hex').slice(0, 12),
            capturedAt:     new Date().toISOString()
        };

        return fp;
    }

    /**
     * Compute a drift score (0–100) between two fingerprints.
     *
     * @param {object} current  - New fingerprint from current scrape
     * @param {object} baseline - Stored baseline fingerprint
     * @returns {{ score: number, changes: string[] }}
     */
    computeDriftScore(current, baseline) {
        if (!baseline || !current) return { score: 0, changes: [] };

        const changes = [];
        let totalDeviation = 0;
        const numericFields = [
            'tableCount', 'formCount', 'inputCount', 'selectCount',
            'linkCount', 'tdCount', 'thCount', 'divCount'
        ];

        for (const field of numericFields) {
            const base = baseline[field] || 0;
            const curr = current[field]  || 0;
            if (base === 0 && curr === 0) continue;

            const max   = Math.max(base, curr, 1);
            const delta = Math.abs(base - curr) / max;

            if (delta > 0.5) {
                changes.push(`${field}: ${base} → ${curr} (Δ${(delta * 100).toFixed(0)}%)`);
                totalDeviation += delta;
            }
        }

        // Structural hash divergence is a strong signal
        if (current.structuralHash !== baseline.structuralHash) {
            changes.push(`structuralHash changed: ${baseline.structuralHash} → ${current.structuralHash}`);
            totalDeviation += 0.5;
        }

        // Boolean flag changes
        if (current.hasLoginForm !== baseline.hasLoginForm) {
            changes.push(`hasLoginForm: ${baseline.hasLoginForm} → ${current.hasLoginForm}`);
            totalDeviation += 1.0;
        }
        if (current.hasAspNetForm !== baseline.hasAspNetForm) {
            changes.push(`hasAspNetForm: ${baseline.hasAspNetForm} → ${current.hasAspNetForm}`);
            totalDeviation += 0.8;
        }

        // HTML length change > 40% is significant
        const baseLen = baseline.htmlLength || 1;
        const currLen = current.htmlLength  || 1;
        const lenDelta = Math.abs(baseLen - currLen) / Math.max(baseLen, currLen);
        if (lenDelta > 0.4) {
            changes.push(`htmlLength: ${baseLen} → ${currLen} (Δ${(lenDelta * 100).toFixed(0)}%)`);
            totalDeviation += lenDelta * 2;
        }

        const score = Math.min(100, Math.round(totalDeviation * 20));
        return { score, changes };
    }

    /**
     * Classify drift score into actionable severity level.
     *
     * @param {number} score
     * @returns {{ severity: string, action: string, shouldAlert: boolean, shouldSuspend: boolean }}
     */
    classifyDrift(score) {
        if (score <= DRIFT_THRESHOLDS.NEGLIGIBLE) {
            return { severity: 'none',     action: 'continue',  shouldAlert: false, shouldSuspend: false };
        } else if (score <= DRIFT_THRESHOLDS.MINOR) {
            return { severity: 'minor',    action: 'log_warn',  shouldAlert: false, shouldSuspend: false };
        } else if (score <= DRIFT_THRESHOLDS.MAJOR) {
            return { severity: 'major',    action: 'alert',     shouldAlert: true,  shouldSuspend: false };
        } else {
            return { severity: 'critical', action: 'suspend',   shouldAlert: true,  shouldSuspend: true  };
        }
    }

    /**
     * Analyze current HTML against stored baseline and return drift result.
     * Automatically stores a new baseline if none exists.
     *
     * @param {string} html
     * @param {string} pageName
     * @param {{ userId?: string, requestId?: string }} [ctx]
     * @returns {Promise<{ score: number, severity: string, changes: string[], action: string, shouldSuspend: boolean }>}
     */
    async analyze(html, pageName, ctx = {}) {
        const current  = this.fingerprint(html, pageName);
        const baseline = await this._loadBaseline(pageName);

        if (!baseline) {
            // No baseline yet — store this as the first baseline
            await this._saveBaseline(pageName, current);
            logger.info(`[DriftDetector] Stored initial baseline for page "${pageName}"`);
            return { score: 0, severity: 'none', changes: [], action: 'baseline_stored', shouldSuspend: false };
        }

        const { score, changes } = this.computeDriftScore(current, baseline);
        const { severity, action, shouldAlert, shouldSuspend } = this.classifyDrift(score);

        if (severity === 'none') {
            return { score, severity, changes, action, shouldSuspend };
        }

        logger.warn(`[DriftDetector] Page "${pageName}" drift score: ${score}/100 (${severity}). Changes: ${changes.join('; ')}`);

        if (shouldAlert) {
            try {
                const providerMetrics = require('../../telemetry/ProviderMetrics');
                providerMetrics.recordDOMDrift('sitam-scraper', pageName, score);
            } catch (_) {}
        }

        if (shouldSuspend) {
            throw new SelectorDriftError(
                `Critical DOM drift detected on page "${pageName}" (score: ${score}/100). ERP may have been redesigned.`,
                {
                    providerName:     'sitam-scraper',
                    operationName:    `scrape:${pageName}`,
                    selectorAttempts: changes
                }
            );
        }

        return { score, severity, changes, action, shouldSuspend };
    }

    /**
     * Manually update the stored baseline (call after confirming new layout is correct).
     *
     * @param {string} pageName
     * @param {string} html
     */
    async updateBaseline(pageName, html) {
        const fp = this.fingerprint(html, pageName);
        await this._saveBaseline(pageName, fp);
        logger.info(`[DriftDetector] Baseline updated for page "${pageName}"`);
    }

    /**
     * Get all stored baselines (for admin/debug).
     *
     * @returns {Promise<object>}
     */
    async getAllBaselines() {
        const pages = ['login', 'profile', 'marks', 'fees', 'assignments'];
        const result = {};
        for (const page of pages) {
            result[page] = await this._loadBaseline(page);
        }
        return result;
    }

    // ─── Private Storage ──────────────────────────────────────────────────────

    async _loadBaseline(pageName) {
        const key = `${REDIS_PREFIX}${pageName}`;

        try {
            if (redisService.isAlive()) {
                const raw = await redisService.client.get(key);
                if (raw) return JSON.parse(raw);
            }
        } catch (_) {}

        // Fallback: in-memory cache
        if (this._localCache.has(pageName)) return this._localCache.get(pageName);

        // Fallback: file system
        try {
            if (fs.existsSync(FALLBACK_FILE)) {
                const all = JSON.parse(fs.readFileSync(FALLBACK_FILE, 'utf8'));
                if (all[pageName]) {
                    this._localCache.set(pageName, all[pageName]);
                    return all[pageName];
                }
            }
        } catch (_) {}

        return null;
    }

    async _saveBaseline(pageName, fingerprint) {
        const key = `${REDIS_PREFIX}${pageName}`;
        this._localCache.set(pageName, fingerprint);

        try {
            if (redisService.isAlive()) {
                await redisService.client.set(key, JSON.stringify(fingerprint), 'EX', BASELINE_TTL_SECS);
                return;
            }
        } catch (_) {}

        // Fallback: file system
        try {
            const dataDir = path.dirname(FALLBACK_FILE);
            if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

            let all = {};
            try { all = JSON.parse(fs.readFileSync(FALLBACK_FILE, 'utf8')); } catch (_) {}
            all[pageName] = fingerprint;
            fs.writeFileSync(FALLBACK_FILE, JSON.stringify(all, null, 2), 'utf8');
        } catch (fsErr) {
            logger.warn(`[DriftDetector] Could not persist baseline for "${pageName}": ${fsErr.message}`);
        }
    }

    _emptyFingerprint(pageName) {
        return {
            page: pageName, htmlLength: 0, tableCount: 0, formCount: 0, inputCount: 0,
            selectCount: 0, linkCount: 0, h1Count: 0, h2Count: 0, tdCount: 0,
            thCount: 0, divCount: 0, spanCount: 0,
            hasAspNetForm: false, hasLoginForm: false, hasTableData: false,
            structuralHash: 'empty', capturedAt: new Date().toISOString()
        };
    }
}

module.exports = new DOMDriftDetector();
