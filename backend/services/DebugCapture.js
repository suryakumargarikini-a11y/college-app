'use strict';

/**
 * SITAM Smart ERP — Debug Capture Service
 *
 * Automatically captures diagnostic artifacts when a scrape fails.
 * Saves everything needed to reproduce and diagnose a production failure
 * without replaying credentials.
 *
 * DIRECTORY STRUCTURE:
 *   logs/debug/<requestId>/
 *     manifest.json        — capture metadata (timestamp, stage, url, userId)
 *     <stage>.png          — full-page screenshot at point of failure
 *     <stage>.html         — full page HTML at point of failure
 *     console.json         — all browser console.log / console.error messages
 *     network.json         — all network requests (url, method, status, timing)
 *
 * USAGE:
 *   const capture = new DebugCapture(requestId, userId);
 *   await capture.attach(page);          // call once after page is created
 *   await capture.captureFailure(page, 'login');
 *   await capture.captureFailure(page, 'profile');
 *   await capture.finalizeManifest();    // call in finally block
 *
 * SAFETY:
 *   - All capture operations are wrapped in try/catch — never throw.
 *   - Credentials are NEVER captured (cookies, passwords).
 *   - Files are written synchronously-in-async via fs.promises — no blocking.
 *   - Old captures auto-purge after DEBUG_CAPTURE_RETENTION_DAYS (default: 7).
 *   - Disabled in production unless DEBUG_CAPTURE_ENABLED=true.
 *
 * PRIVACY:
 *   Captures contain student PII (page content). Store logs/ outside web root.
 *   On Railway/Render: mount a volume or use an external log service.
 *
 * @module DebugCapture
 */

const fs     = require('fs');
const path   = require('path');
const logger = require('./logger');

const ENABLED           = process.env.DEBUG_CAPTURE_ENABLED === 'true' ||
                          process.env.NODE_ENV !== 'production';
const RETENTION_DAYS    = parseInt(process.env.DEBUG_CAPTURE_RETENTION_DAYS || '7', 10);
const BASE_DIR          = path.resolve(
    process.env.DEBUG_CAPTURE_DIR || path.join(process.cwd(), 'logs', 'debug')
);
const MAX_CAPTURES      = parseInt(process.env.DEBUG_CAPTURE_MAX || '200', 10);
const SCREENSHOT_FORMAT = 'png';

class DebugCapture {
    /**
     * @param {string} requestId - Correlation ID (becomes the directory name)
     * @param {string} [userId]  - Student user ID (for manifest only — never in screenshots)
     */
    constructor(requestId, userId = 'unknown') {
        this.requestId    = requestId;
        this.userId       = userId;
        this.captureDir   = path.join(BASE_DIR, requestId);
        this.consoleLog   = [];   // { level, text, timestamp }[]
        this.networkLog   = [];   // { url, method, status, duration }[]
        this.capturedStages = []; // stages captured so far
        this._initialized = false;
        this._listeners   = new WeakMap(); // page → { console, request, response }
    }

    // ─── Setup ────────────────────────────────────────────────────────────────

    /**
     * Attach console and network listeners to a page.
     * Call once after page creation — captures all events until capture is finalized.
     *
     * @param {import('./browserPool/providers/adapters/IPageAdapter')} page
     */
    async attach(page) {
        if (!ENABLED) return;
        if (!page || !page.nativePage) return; // IPageAdapter without nativePage = non-Puppeteer page

        const nativePage = page.nativePage;
        this._ensureDir();

        // ── Console listener ────────────────────────────────────────────────
        const onConsole = (msg) => {
            this.consoleLog.push({
                level:     msg.type(),
                text:      msg.text().slice(0, 500), // cap at 500 chars
                timestamp: new Date().toISOString(),
            });
        };

        // ── Network listener ────────────────────────────────────────────────
        const requestTimings = new Map();

        const onRequest = (req) => {
            requestTimings.set(req.url(), Date.now());
        };

        const onResponse = (res) => {
            const start = requestTimings.get(res.url()) || Date.now();
            requestTimings.delete(res.url());
            this.networkLog.push({
                url:      res.url().slice(0, 200),  // truncate long URLs
                method:   res.request().method(),
                status:   res.status(),
                duration: Date.now() - start,
            });
            // Cap network log at 500 entries to avoid memory explosion
            if (this.networkLog.length > 500) this.networkLog.shift();
        };

        try {
            nativePage.on('console', onConsole);
            nativePage.on('request',  onRequest);
            nativePage.on('response', onResponse);
            this._listeners.set(nativePage, { onConsole, onRequest, onResponse });
        } catch (_) {}
    }

    // ─── Capture ──────────────────────────────────────────────────────────────

    /**
     * Capture a screenshot and HTML dump at the current page state.
     * Call this in a catch block when a scrape stage fails.
     *
     * @param {import('./browserPool/providers/adapters/IPageAdapter')} page
     * @param {string} stage - e.g. 'login', 'profile', 'attendance'
     */
    async captureFailure(page, stage) {
        if (!ENABLED || !page) return;
        this._ensureDir();

        // Screenshot
        await this._captureScreenshot(page, stage);
        // HTML
        await this._captureHtml(page, stage);

        this.capturedStages.push(stage);
        logger.info(
            `[DebugCapture] Captured failure: req=${this.requestId} stage=${stage} ` +
            `dir=${this.captureDir}`
        );
    }

    /**
     * Write console.json, network.json, and manifest.json.
     * Call in the finally block of the scrape job.
     */
    async finalizeManifest() {
        if (!ENABLED) return;
        if (!this._initialized && this.capturedStages.length === 0) return;
        this._ensureDir();

        await this._writeJson('console.json', this.consoleLog);
        await this._writeJson('network.json', this.networkLog);
        await this._writeJson('manifest.json', {
            requestId:      this.requestId,
            userId:         this.userId,
            capturedAt:     new Date().toISOString(),
            stages:         this.capturedStages,
            consoleEntries: this.consoleLog.length,
            networkEntries: this.networkLog.length,
            captureDir:     this.captureDir,
        });
    }

    // ─── Housekeeping ─────────────────────────────────────────────────────────

    /**
     * Purge captures older than RETENTION_DAYS.
     * Call this from a daily maintenance job or server startup.
     */
    static async purgeOldCaptures() {
        if (!fs.existsSync(BASE_DIR)) return;

        try {
            const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
            const entries = fs.readdirSync(BASE_DIR, { withFileTypes: true });

            let purged = 0;
            for (const entry of entries) {
                if (!entry.isDirectory()) continue;
                const dirPath = path.join(BASE_DIR, entry.name);
                try {
                    const stat = fs.statSync(dirPath);
                    if (stat.mtimeMs < cutoff) {
                        fs.rmSync(dirPath, { recursive: true, force: true });
                        purged++;
                    }
                } catch (_) {}
            }

            if (purged > 0) {
                logger.info(`[DebugCapture] Purged ${purged} old capture directories`);
            }

            // Also enforce MAX_CAPTURES cap (oldest first)
            const remaining = fs.readdirSync(BASE_DIR, { withFileTypes: true })
                .filter(e => e.isDirectory())
                .map(e => ({
                    name: e.name,
                    path: path.join(BASE_DIR, e.name),
                    mtime: fs.statSync(path.join(BASE_DIR, e.name)).mtimeMs
                }))
                .sort((a, b) => a.mtime - b.mtime);

            if (remaining.length > MAX_CAPTURES) {
                const toDelete = remaining.slice(0, remaining.length - MAX_CAPTURES);
                for (const d of toDelete) {
                    try { fs.rmSync(d.path, { recursive: true, force: true }); } catch (_) {}
                }
                logger.info(`[DebugCapture] Evicted ${toDelete.length} captures (max=${MAX_CAPTURES})`);
            }
        } catch (err) {
            logger.warn(`[DebugCapture] Purge error: ${err.message}`);
        }
    }

    /**
     * Check if debug capture is enabled.
     * @returns {boolean}
     */
    static isEnabled() {
        return ENABLED;
    }

    /**
     * Get the base directory where all captures are stored.
     * @returns {string}
     */
    static getBaseDir() {
        return BASE_DIR;
    }

    // ─── Private ──────────────────────────────────────────────────────────────

    _ensureDir() {
        if (this._initialized) return;
        try {
            fs.mkdirSync(this.captureDir, { recursive: true });
            this._initialized = true;
        } catch (_) {}
    }

    async _captureScreenshot(page, stage) {
        try {
            const nativePage = page.nativePage || page;
            if (typeof nativePage.screenshot === 'function') {
                await nativePage.screenshot({
                    path:     path.join(this.captureDir, `${stage}.${SCREENSHOT_FORMAT}`),
                    fullPage: true,
                    type:     SCREENSHOT_FORMAT,
                });
            }
        } catch (err) {
            logger.warn(`[DebugCapture] Screenshot failed for stage=${stage}: ${err.message}`);
        }
    }

    async _captureHtml(page, stage) {
        try {
            const html = await page.content();
            // Scrub session cookies from HTML (defence in depth — they shouldn't be in HTML anyway)
            const sanitized = html.replace(
                /(?:ASP\.NET_SessionId|\.ASPXAUTH|__RequestVerificationToken)=[^;"\s]*/gi,
                '[REDACTED]'
            );
            await fs.promises.writeFile(
                path.join(this.captureDir, `${stage}.html`),
                sanitized,
                'utf8'
            );
        } catch (err) {
            logger.warn(`[DebugCapture] HTML capture failed for stage=${stage}: ${err.message}`);
        }
    }

    async _writeJson(filename, data) {
        try {
            await fs.promises.writeFile(
                path.join(this.captureDir, filename),
                JSON.stringify(data, null, 2),
                'utf8'
            );
        } catch (_) {}
    }
}

module.exports = DebugCapture;
