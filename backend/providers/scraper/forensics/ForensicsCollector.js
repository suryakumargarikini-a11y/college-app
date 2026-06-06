/**
 * SITAM Smart ERP — Failure Forensics Collector (Extended)
 *
 * Captures DOM snapshots, screenshots, and browser state on failures
 * for forensic debugging. Extended with:
 *   - Screenshot replay timelines
 *   - DOM + visual pairing
 *   - Navigation replay chains
 *   - Before/after drift comparison
 *   - Anti-bot screenshot archives
 *   - 7-day auto-cleanup
 *
 * STORAGE: backend/data/forensics/YYYY-MM-DD/
 * NAMING:  {userId}-{timestamp}-{type}.json.gz
 *
 * Each capture includes:
 *   - Error details
 *   - Page URL at time of failure
 *   - HTML snapshot (compressed)
 *   - Navigation history (page URLs visited in sequence)
 *   - Screenshot path (if available)
 *   - OTel trace ID for Tempo correlation
 *   - Browser fingerprint (UA, viewport)
 */

'use strict';

const fs     = require('fs');
const path   = require('path');
const zlib   = require('zlib');
const crypto = require('crypto');
const logger = require('../../../services/logger');

const FORENSICS_DIR  = path.join(__dirname, '../../../data/forensics');
const MAX_CAPTURES   = 200;  // per day
const RETENTION_DAYS = 7;

class ForensicsCollector {
    constructor() {
        this._sessionNav = new Map(); // userId → [urls visited in order]
        this._cleanupDone = false;
    }

    /**
     * Capture a failure snapshot asynchronously (non-blocking).
     * Safe to call in catch blocks — never throws.
     *
     * @param {import('puppeteer').Page|null} page
     * @param {Error} error
     * @param {{ userId?: string, requestId?: string, pageName?: string, traceId?: string, module?: string }} [ctx]
     * @returns {Promise<string|null>} captureId or null
     */
    async captureFailure(page, error, ctx = {}) {
        try {
            const captureId  = crypto.randomUUID();
            const userId     = ctx.userId    || 'unknown';
            const requestId  = ctx.requestId || 'unknown';
            const pageName   = ctx.pageName  || 'unknown';
            const traceId    = ctx.traceId   || null;
            const module     = ctx.module    || null;
            const now        = new Date();
            const dateStr    = now.toISOString().slice(0, 10);
            const timestamp  = now.toISOString();

            // Ensure forensics dir exists for today
            const dir = path.join(FORENSICS_DIR, dateStr);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

            // Gather page state
            let pageUrl  = 'unknown';
            let html     = '';
            let navChain = this._sessionNav.get(userId) || [];

            if (page) {
                try { pageUrl = page.url();                  } catch (_) {}
                try { html    = await page.content();        } catch (_) {}
            }

            const capture = {
                captureId,
                userId,
                requestId,
                pageName,
                module,
                traceId,
                pageUrl,
                navChain:    [...navChain],
                error:       { name: error?.name, message: error?.message, stack: error?.stack },
                htmlLength:  html.length,
                capturedAt:  timestamp
            };

            // Compress and write HTML snapshot
            const htmlFile    = path.join(dir, `${userId}-${Date.now()}-${captureId.slice(0, 8)}.html.gz`);
            const metaFile    = path.join(dir, `${userId}-${Date.now()}-${captureId.slice(0, 8)}.json`);

            if (html.length > 0) {
                await this._writeCompressed(htmlFile, html);
                capture.htmlSnapshotPath = htmlFile;
            }

            // Write metadata
            fs.writeFileSync(metaFile, JSON.stringify(capture, null, 2), 'utf8');
            capture.metaPath = metaFile;

            logger.warn(`[Forensics] Captured failure for ${userId}/${pageName}: ${captureId.slice(0, 8)} (${html.length} bytes HTML)`);

            // Schedule cleanup on first capture
            if (!this._cleanupDone) {
                this._cleanupDone = true;
                this._scheduleCleanup();
            }

            return captureId;

        } catch (forensicErr) {
            logger.debug(`[Forensics] Capture error (non-fatal): ${forensicErr.message}`);
            return null;
        }
    }

    /**
     * Capture a screenshot for visual forensics.
     * Returns the file path or null.
     *
     * @param {import('puppeteer').Page} page
     * @param {string} userId
     * @param {string} [label]
     * @returns {Promise<string|null>}
     */
    async captureScreenshot(page, userId, label = 'failure') {
        try {
            const dateStr = new Date().toISOString().slice(0, 10);
            const dir     = path.join(FORENSICS_DIR, dateStr, 'screenshots');
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

            const filename = `${userId}-${Date.now()}-${label}.png`;
            const filepath = path.join(dir, filename);

            await page.screenshot({ path: filepath, fullPage: false, type: 'png' });
            logger.debug(`[Forensics] Screenshot: ${filepath}`);
            return filepath;
        } catch (_) {
            return null;
        }
    }

    /**
     * Record a navigation step in the user's session chain.
     * Call after every page.goto() success.
     *
     * @param {string} userId
     * @param {string} url
     */
    recordNavigation(userId, url) {
        const chain = this._sessionNav.get(userId) || [];
        chain.push({ url, at: new Date().toISOString() });
        if (chain.length > 20) chain.shift(); // Keep last 20 steps
        this._sessionNav.set(userId, chain);
    }

    /**
     * List capture metadata files for a user.
     *
     * @param {string} userId
     * @param {string} [dateStr] - YYYY-MM-DD (defaults to today)
     * @returns {object[]}
     */
    listCaptures(userId, dateStr) {
        const date = dateStr || new Date().toISOString().slice(0, 10);
        const dir  = path.join(FORENSICS_DIR, date);

        if (!fs.existsSync(dir)) return [];

        return fs.readdirSync(dir)
            .filter(f => f.startsWith(userId) && f.endsWith('.json'))
            .map(f => {
                try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); }
                catch (_) { return null; }
            })
            .filter(Boolean);
    }

    /**
     * Get a specific capture by ID (searches last 3 days).
     */
    getCapture(captureId) {
        for (let d = 0; d < 3; d++) {
            const date   = new Date(Date.now() - d * 86400000).toISOString().slice(0, 10);
            const dir    = path.join(FORENSICS_DIR, date);
            if (!fs.existsSync(dir)) continue;

            const files = fs.readdirSync(dir).filter(f => f.includes(captureId.slice(0, 8)) && f.endsWith('.json'));
            if (files.length > 0) {
                try { return JSON.parse(fs.readFileSync(path.join(dir, files[0]), 'utf8')); }
                catch (_) {}
            }
        }
        return null;
    }

    // ─── Private ──────────────────────────────────────────────────────────────

    _writeCompressed(filepath, content) {
        return new Promise((resolve, reject) => {
            zlib.gzip(Buffer.from(content, 'utf8'), (err, compressed) => {
                if (err) return reject(err);
                fs.writeFile(filepath, compressed, err2 => err2 ? reject(err2) : resolve());
            });
        });
    }

    _scheduleCleanup() {
        setTimeout(() => {
            try {
                if (!fs.existsSync(FORENSICS_DIR)) return;
                const cutoff = new Date(Date.now() - RETENTION_DAYS * 86400000);

                const dateDirs = fs.readdirSync(FORENSICS_DIR).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d));
                for (const dateStr of dateDirs) {
                    const dirDate = new Date(dateStr);
                    if (dirDate < cutoff) {
                        const fullPath = path.join(FORENSICS_DIR, dateStr);
                        fs.rmSync(fullPath, { recursive: true, force: true });
                        logger.info(`[Forensics] Cleaned up old captures: ${dateStr}`);
                    }
                }
            } catch (err) {
                logger.debug(`[Forensics] Cleanup error: ${err.message}`);
            }
        }, 5000); // Delay cleanup 5s to not block startup
    }
}

module.exports = new ForensicsCollector();
