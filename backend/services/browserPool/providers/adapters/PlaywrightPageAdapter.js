'use strict';

/**
 * SITAM Smart ERP — PlaywrightPageAdapter
 *
 * Wraps a Playwright Page to match the IPageAdapter interface consumed by
 * ErpBrowserService, page objects, and DebugCapture.
 *
 * KEY API DIFFERENCES vs Puppeteer (handled transparently here):
 *   - page.fill(sel, text)     instead of page.type(sel, text)  (Playwright)
 *   - page.setViewportSize()   instead of page.setViewport()    (Playwright)
 *   - page.waitForFunction()   args wrapped differently          (Playwright)
 *   - page.locator()           preferred but we use waitForSelector for compat
 *
 * DebugCapture compatibility:
 *   - `nativePage` getter exposes the raw Playwright page so DebugCapture can
 *     attach console/network listeners using the identical .on('console', ...) API.
 *
 * @module PlaywrightPageAdapter
 */

const IPageAdapter = require('./IPageAdapter');

class PlaywrightPageAdapter extends IPageAdapter {
    /**
     * @param {import('playwright-core').Page} page
     */
    constructor(page) {
        super();
        this._page = page;
    }

    // ─── Navigation ────────────────────────────────────────────────────────────

    /**
     * Navigate to a URL.
     * Translates Puppeteer waitUntil values to Playwright equivalents.
     *
     * @param {string} url
     * @param {{ waitUntil?: string, timeout?: number }} [opts]
     */
    async goto(url, opts = {}) {
        // Puppeteer 'networkidle2' → Playwright 'networkidle'
        // Puppeteer 'domcontentloaded' → Playwright 'domcontentloaded' (same)
        // Puppeteer 'load' → Playwright 'load' (same)
        const waitUntil = opts.waitUntil === 'networkidle2'
            ? 'networkidle'
            : (opts.waitUntil || 'load');

        return this._page.goto(url, {
            waitUntil,
            timeout: opts.timeout || 30000,
        });
    }

    /**
     * @param {{ width: number, height: number }} viewport
     */
    async setViewport(viewport) {
        await this._page.setViewportSize({ width: viewport.width, height: viewport.height });
    }

    /**
     * @param {string} ua
     */
    async setUserAgent(ua) {
        // Playwright UA is set at context creation time.
        // Per-page override is not natively supported; this is a no-op
        // because the UA is already correctly set on the context by PlaywrightProvider.
    }

    // ─── Selectors ─────────────────────────────────────────────────────────────

    /**
     * @param {string} selector
     * @param {{ timeout?: number, visible?: boolean }} [opts]
     */
    async waitForSelector(selector, opts = {}) {
        return this._page.waitForSelector(selector, {
            timeout: opts.timeout || 30000,
            state:   opts.visible === false ? 'attached' : 'visible',
        });
    }

    /**
     * @param {string} selector
     */
    async click(selector) {
        await this._page.click(selector);
    }

    /**
     * Type text into a field.
     * Playwright uses fill() for reliable text input instead of type().
     *
     * @param {string} selector
     * @param {string} text
     * @param {{ delay?: number }} [opts]  — delay is ignored in Playwright fill()
     */
    async type(selector, text, opts = {}) {
        // Some legacy ERP pages (e.g. SITAM ECAP) run keyup/keypress JS event handlers
        // to hash passwords and populate hidden fields (like hdnpwd2) before submission.
        // Direct fill() bypasses keyboard events. We focus, clear, and type sequentially.
        await this._page.focus(selector);
        await this._page.fill(selector, '');
        await this._page.type(selector, text, { delay: opts.delay || 30 });
    }

    // ─── Evaluation ────────────────────────────────────────────────────────────

    /**
     * @param {Function|string} fn
     * @param {...any} args
     */
    async evaluate(fn, ...args) {
        return this._page.evaluate(fn, ...args);
    }

    /**
     * Wait for a JS expression to return truthy.
     *
     * Puppeteer: page.waitForFunction(fn, opts, ...args)
     * Playwright: page.waitForFunction(fn, args[0], opts)   ← different signature
     *
     * @param {Function|string} fn
     * @param {{ timeout?: number }} [opts]
     * @param {...any} args
     */
    async waitForFunction(fn, opts = {}, ...args) {
        // Playwright waitForFunction takes (fn, arg, options) — single arg only.
        // Pack multiple args into an array and unpack inside fn if needed.
        const arg = args.length === 1 ? args[0] : args;
        return this._page.waitForFunction(fn, arg, { timeout: opts.timeout || 30000 });
    }

    /**
     * Wait for navigation to complete.
     * @param {{ waitUntil?: string, timeout?: number }} [opts]
     */
    async waitForNavigation(opts = {}) {
        const waitUntil = opts.waitUntil === 'networkidle2' ? 'networkidle' : (opts.waitUntil || 'load');
        return this._page.waitForNavigation({ waitUntil, timeout: opts.timeout || 30000 });
    }

    // ─── Content / Media ───────────────────────────────────────────────────────

    /**
     * Get the full page HTML content.
     * @returns {Promise<string>}
     */
    async content() {
        return this._page.content();
    }

    /**
     * Take a screenshot.
     * @param {{ path?: string, fullPage?: boolean }} [opts]
     * @returns {Promise<Buffer>}
     */
    async screenshot(opts = {}) {
        return this._page.screenshot({ fullPage: opts.fullPage || false, path: opts.path });
    }

    // ─── URL / State ───────────────────────────────────────────────────────────

    /**
     * @returns {string}
     */
    url() {
        return this._page.url();
    }

    // ─── Cookie helpers ────────────────────────────────────────────────────────

    /**
     * Read all cookies visible to the current page.
     * @returns {Promise<Array<{ name: string, value: string }>>}
     */
    async cookies() {
        return this._page.context().cookies();
    }

    // ─── Events ────────────────────────────────────────────────────────────────

    /**
     * Register a page-level event listener.
     * @param {string}   event
     * @param {Function} callback
     */
    on(event, callback) {
        this._page.on(event, callback);
    }

    /**
     * Close this page.
     */
    async close() {
        try { await this._page.close(); } catch (_) {}
    }

    // ─── DebugCapture compatibility ────────────────────────────────────────────

    /**
     * Expose the raw Playwright Page for DebugCapture and any provider-specific
     * operations that need the native API directly.
     *
     * DebugCapture uses nativePage.on('console', ...) and nativePage.on('request', ...)
     * which are identical in Playwright — no changes needed in DebugCapture.
     *
     * @returns {import('playwright-core').Page}
     */
    get nativePage() {
        return this._page;
    }
}

module.exports = PlaywrightPageAdapter;
