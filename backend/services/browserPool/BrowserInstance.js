'use strict';

/**
 * BrowserInstance — Single Chromium Browser Wrapper
 *
 * Wraps one Puppeteer browser process and tracks:
 *   - Health (connected, responsive)
 *   - Lifetime (job count, age in ms)
 *   - Reputation (via BrowserReputationManager)
 *
 * Provides clean checkout/checkin of isolated incognito contexts.
 * Each checkout creates a fresh BrowserContext — zero shared state between students.
 *
 * Lifecycle limits (configurable via env):
 *   BROWSER_MAX_JOBS      = 100  — force recycle after N jobs
 *   BROWSER_MAX_LIFETIME_MS = 1800000 (30 min) — force recycle after N ms uptime
 *
 * @module BrowserInstance
 */

const logger = require('../logger');
const repMgr = require('../../providers/scraper/browser/BrowserReputationManager');
const classifier = require('../../providers/scraper/retry/AdaptiveRetryClassifier');

const MAX_JOBS_PER_BROWSER = parseInt(process.env.BROWSER_MAX_JOBS || '100', 10);
const BROWSER_MAX_LIFETIME_MS = parseInt(
    process.env.BROWSER_MAX_LIFETIME_MS || String(30 * 60 * 1000),
    10
);

const STEALTH_USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
];

class BrowserInstance {
    /**
     * @param {Object} opts
     * @param {string}   opts.poolName   - 'AUTH_POOL' or 'SYNC_POOL'
     * @param {string[]} opts.launchArgs - Chromium CLI flags
     * @param {Function} opts.onCrash    - Called with (this) on unexpected disconnect
     */
    constructor({ poolName, launchArgs, onCrash }) {
        this.id = `${poolName.toLowerCase()}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        this.poolName = poolName;
        this.launchArgs = launchArgs;
        this.onCrash = onCrash;

        /** @type {import('puppeteer').Browser|null} */
        this.browser = null;
        this.pid = null;
        this.version = 'unknown';

        this.createdAt = 0;
        this.lastUsed = 0;
        this.jobCount = 0;

        this.inUse = false;
        this.healthy = false;
        this.retired = false;
    }

    // ─── Lifecycle ────────────────────────────────────────────────────────────

    /**
     * Launch the underlying Chromium process and attach event listeners.
     * @param {string|undefined|null} executablePath
     * @returns {Promise<BrowserInstance>} this instance (fluent)
     */
    async launch(executablePath) {
        const puppeteer = require('puppeteer');
        const t0 = Date.now();
        logger.info(`[POOL][${this.poolName}] Browser Created: ${this.id}`);

        this.browser = await puppeteer.launch({
            headless: true,
            executablePath: executablePath || undefined,
            args: this.launchArgs,
        });

        // Capture PID for diagnostics
        const proc = typeof this.browser.process === 'function' ? this.browser.process() : null;
        this.pid = proc ? proc.pid : null;
        if (proc) {
            proc.on('exit', (code, signal) => {
                logger.warn(
                    `[POOL][${this.poolName}] Chromium process exited: ` +
                    `id=${this.id} pid=${this.pid} code=${code} signal=${signal}`
                );
            });
        }

        // Get browser version string for logs
        try {
            if (typeof this.browser.version === 'function') {
                this.version = await this.browser.version();
            }
        } catch (_) {}

        this.createdAt = Date.now();
        this.lastUsed = Date.now();
        this.healthy = true;

        repMgr.registerBrowser(this.id);

        // Handle unexpected disconnect — crash recovery callback
        this.browser.on('disconnected', () => {
            if (this.retired) return; // already being cleaned up

            logger.warn(`[POOL][${this.poolName}] Browser Destroyed (crashed): ${this.id}`);
            repMgr.recordCrash(this.id);
            repMgr.retire(this.id);
            this.healthy = false;
            this.retired = true;

            // Notify pool to replace this instance and drain queue
            try { this.onCrash(this); } catch (_) {}

            // Update Prometheus crash counter
            try {
                require('../metricsService').metrics.browserCrashesTotal.inc();
            } catch (_) {}
        });

        const elapsed = Date.now() - t0;
        logger.info(
            `[POOL][${this.poolName}] Browser ready: ${this.id} ` +
            `v=${this.version} pid=${this.pid} launched_in=${elapsed}ms`
        );
        return this;
    }

    /**
     * Forcefully close the browser and mark as retired.
     * @param {string} [reason='manual']
     */
    async destroy(reason = 'manual') {
        if (this.retired) return; // idempotent
        this.retired = true;
        this.healthy = false;
        repMgr.retire(this.id);
        logger.info(`[POOL][${this.poolName}] Browser Destroyed: ${this.id} reason=${reason}`);
        try { await this.browser.close(); } catch (_) {}
    }

    // ─── Health ───────────────────────────────────────────────────────────────

    /**
     * Check if the browser process is still alive and responsive.
     * Performs an async ping (pages() list) to confirm responsiveness.
     * @returns {Promise<boolean>}
     */
    async isHealthy() {
        if (this.retired || !this.browser) return false;
        try {
            const connected = typeof this.browser.isConnected === 'function'
                ? this.browser.isConnected()
                : true;
            if (!connected) return false;
            if (typeof this.browser.pages === 'function') await this.browser.pages();
            return true;
        } catch (_) {
            return false;
        }
    }

    /**
     * Returns true if this browser should be recycled before its next job.
     * Checked by BrowserPool at release time.
     */
    needsRecycle() {
        if (this.retired || !this.healthy) return true;
        if (this.jobCount >= MAX_JOBS_PER_BROWSER) return true;
        if (this.createdAt && (Date.now() - this.createdAt) >= BROWSER_MAX_LIFETIME_MS) return true;
        if (repMgr.isQuarantined(this.id) || repMgr.isRetired(this.id)) return true;
        return false;
    }

    // ─── Context checkout / checkin ───────────────────────────────────────────

    /**
     * Create a fresh isolated incognito BrowserContext for one job.
     * Wraps context.newPage() with stealth UA, viewport, and SSRF guard.
     *
     * @param {string} requestId - Correlation ID
     * @returns {Promise<{ context: import('puppeteer').BrowserContext, ua: string }>}
     * @throws {Error} if browser is not healthy at checkout time
     */
    async checkout(requestId) {
        // Mark busy BEFORE async work — prevents double-checkout race
        this.inUse = true;
        this.lastUsed = Date.now();
        this.jobCount++;

        logger.info(
            `[POOL][${this.poolName}] Browser Busy: ${this.id} ` +
            `job=#${this.jobCount} req=${requestId}`
        );

        // Final health gate — last chance to catch a zombie
        const alive = await this.isHealthy();
        if (!alive) {
            this.inUse = false;
            throw new Error(
                `[BrowserInstance] ${this.id} failed health check at checkout (req=${requestId})`
            );
        }

        // Create isolated context
        let context;
        try {
            context = await this.browser.createBrowserContext();
        } catch (ctxErr) {
            this.inUse = false;
            throw new Error(
                `[BrowserInstance] ${this.id} createBrowserContext failed: ${ctxErr.message}`
            );
        }

        // Stealth UA rotated per context
        const ua = STEALTH_USER_AGENTS[Math.floor(Math.random() * STEALTH_USER_AGENTS.length)];

        // Wrap context.newPage to inject stealth settings + SSRF protection
        const origNewPage = context.newPage.bind(context);
        context.newPage = async () => {
            const page = await origNewPage();

            await page.setUserAgent(ua);
            await page.setViewport({
                width:  1280 + Math.floor(Math.random() * 100),
                height:  800 + Math.floor(Math.random() * 100),
            });

            // SSRF guard — blocks scraper requests to loopback/metadata addresses
            try {
                const secSvc = require('../securityService');
                const origGoto = page.goto.bind(page);
                page.goto = async (url, opts) => {
                    const valid = await secSvc.validateUrlForScraping(url);
                    if (!valid) {
                        throw new Error(`[Security-SSRF] Blocked request to: ${url}`);
                    }
                    return origGoto(url, opts);
                };
            } catch (_) {
                // securityService optional in test environments
            }

            return page;
        };

        return { context, ua };
    }

    /**
     * Close the incognito context and release the browser back to idle.
     * Updates reputation manager based on job outcome.
     *
     * @param {import('puppeteer').BrowserContext|null} context
     * @param {Error|null} [error=null] - Job error if the job failed
     */
    async checkin(context, error = null) {
        // Update reputation before releasing
        if (error) {
            const strategy = classifier.classify(error);
            const msg = (error.message || '').toLowerCase();
            const isCrash =
                msg.includes('target closed') ||
                msg.includes('session closed') ||
                msg.includes('browser closed');

            if (strategy.action === 'quarantine' || error.constructor.name === 'CaptchaDetectedError') {
                repMgr.recordCaptcha(this.id);
            } else if (isCrash) {
                repMgr.recordCrash(this.id);
            } else {
                repMgr.recordTimeout(this.id);
            }
        } else {
            repMgr.recordSuccess(this.id);
        }

        // Destroy the incognito context — wipes all cookies, sessions, storage
        try {
            if (context && !context._closed) {
                await context.close();
            }
        } catch (closeErr) {
            logger.warn(
                `[POOL][${this.poolName}] Context close warning (non-fatal): ${closeErr.message}`
            );
        }

        this.inUse = false;
        this.lastUsed = Date.now();

        logger.info(
            `[POOL][${this.poolName}] Browser Released: ${this.id} ` +
            `total_jobs=${this.jobCount}`
        );
    }

    // ─── Diagnostics ──────────────────────────────────────────────────────────

    /**
     * Returns a plain stats object for the /api/browserpool endpoint.
     * @returns {Object}
     */
    getStats() {
        return {
            id: this.id,
            poolName: this.poolName,
            pid: this.pid,
            version: this.version,
            inUse: this.inUse,
            healthy: this.healthy,
            retired: this.retired,
            jobCount: this.jobCount,
            maxJobs: MAX_JOBS_PER_BROWSER,
            uptimeSec: this.createdAt
                ? Math.round((Date.now() - this.createdAt) / 1000)
                : 0,
            idleSec: this.lastUsed
                ? Math.round((Date.now() - this.lastUsed) / 1000)
                : 0,
        };
    }
}

module.exports = BrowserInstance;
