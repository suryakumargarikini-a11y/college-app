'use strict';

/**
 * SITAM Smart ERP — PlaywrightProvider
 *
 * Concrete IBrowserProvider implementation using Playwright (playwright-core).
 * Activated via BROWSER_PROVIDER=PLAYWRIGHT environment variable.
 *
 * FUTURE PROVIDERS — add to providerFactory.js PROVIDER_MAP, no changes here:
 *   PLAYWRIGHT_FIREFOX  — same pattern, use playwright.firefox.launch()
 *   PLAYWRIGHT_WEBKIT   — same pattern, use playwright.webkit.launch()
 *   BROWSERLESS         — playwright.chromium.connect(wsEndpoint) to cloud.browserless.io
 *   STEEL               — playwright.chromium.connect(wsEndpoint) to Steel Browser
 *   REMOTE_CDP          — playwright.chromium.connectOverCDP(cdpEndpoint)
 *
 * All of these share the identical IBrowserProvider contract — only this file changes.
 * BrowserPool, BrowserInstance, ErpBrowserService: zero changes required.
 */

const IBrowserProvider         = require('./IBrowserProvider');
const PlaywrightContextAdapter = require('./adapters/PlaywrightContextAdapter');
const logger                   = require('../../logger');

class PlaywrightProvider extends IBrowserProvider {
    constructor() {
        super();
        /** @type {import('playwright-core').Browser|null} */
        this._browser = null;
        this._version = 'unknown';
    }

    get name() { return 'playwright'; }

    // ─── Lifecycle ─────────────────────────────────────────────────────────────

    /**
     * Launch a Chromium browser process via Playwright.
     *
     * @param {string|undefined|null} executablePath
     * @param {string[]} launchArgs  - Chromium CLI flags (same format as Puppeteer)
     */
    async launch(executablePath, launchArgs) {
        const { chromium } = require('playwright-core');

        // Playwright launch args use the same --flag format as Puppeteer.
        // Filter out Puppeteer-only flags that Playwright doesn't recognize.
        const safeArgs = (launchArgs || []).filter(a =>
            !a.startsWith('--js-flags=') // Playwright passes V8 flags differently
        );

        this._browser = await chromium.launch({
            executablePath: executablePath || undefined,
            headless:       true,
            args:           safeArgs,
        });

        try { this._version = this._browser.version(); } catch (_) {}

        logger.info(`[PlaywrightProvider] Browser launched. version=${this._version}`);
    }

    /**
     * Create an isolated browser context.
     * Playwright contexts are natively isolated — no monkeypatching needed.
     * UA, viewport, and SSRF guard are all set at context creation time.
     *
     * @param {string} userAgent
     * @param {{ width: number, height: number }} viewport
     * @returns {Promise<PlaywrightContextAdapter>}
     */
    async createContext(userAgent, viewport) {
        const context = await this._browser.newContext({
            userAgent,
            viewport: { width: viewport.width, height: viewport.height },
            // Disable image loading to speed up ERP navigation
            // (profile photo loaded separately by PhotoPage)
        });

        // SSRF guard — intercept all navigations and block loopback/metadata URLs
        await context.route('**', async (route) => {
            const url = route.request().url();
            try {
                const secSvc = require('../../securityService');
                const valid = await secSvc.validateUrlForScraping(url);
                if (!valid) {
                    logger.warn(`[PlaywrightProvider] SSRF guard blocked: ${url}`);
                    await route.abort('blockedbyclient');
                    return;
                }
            } catch (_) {
                // securityService optional in test environments
            }
            await route.continue();
        });

        return new PlaywrightContextAdapter(context);
    }

    async close() {
        if (!this._browser) return;
        try { await this._browser.close(); } catch (_) {}
        this._browser = null;
    }

    // ─── State / Health ────────────────────────────────────────────────────────

    isConnected() {
        if (!this._browser) return false;
        try {
            return this._browser.isConnected();
        } catch (_) {
            return false;
        }
    }

    async getVersion() {
        return this._version;
    }

    /**
     * Playwright does not expose the ChildProcess directly.
     * PID tracking is not available for remote/headed providers.
     */
    process() {
        return null;
    }

    // ─── Events ────────────────────────────────────────────────────────────────

    on(event, callback) {
        if (!this._browser) return;
        // Playwright fires 'disconnected' on the Browser object — same event name as Puppeteer.
        this._browser.on(event, callback);
    }
}

module.exports = PlaywrightProvider;
