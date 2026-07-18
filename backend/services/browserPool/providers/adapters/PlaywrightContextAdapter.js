'use strict';

/**
 * SITAM Smart ERP — PlaywrightContextAdapter
 *
 * Wraps a Playwright BrowserContext to match the IContextAdapter interface
 * expected by BrowserInstance, DebugCapture, and ErpBrowserService.
 *
 * Playwright contexts are natively isolated (separate cookie jars, storage, etc.)
 * so no extra isolation wiring is needed here — it's guaranteed by the API.
 *
 * @module PlaywrightContextAdapter
 */

const IContextAdapter       = require('./IContextAdapter');
const PlaywrightPageAdapter = require('./PlaywrightPageAdapter');

class PlaywrightContextAdapter extends IContextAdapter {
    /**
     * @param {import('playwright-core').BrowserContext} context
     */
    constructor(context) {
        super();
        this._context = context;
        this._closed  = false;
    }

    // ─── Page creation ─────────────────────────────────────────────────────────

    /**
     * Open a new page in this isolated context.
     * @returns {Promise<PlaywrightPageAdapter>}
     */
    async newPage() {
        const page = await this._context.newPage();
        return new PlaywrightPageAdapter(page);
    }

    // ─── Cookies ───────────────────────────────────────────────────────────────

    /**
     * Retrieve all cookies in this context (Puppeteer-compatible shape).
     * @returns {Promise<Array<{ name: string, value: string }>>}
     */
    async cookies() {
        return this._context.cookies();
    }

    /**
     * Set cookies on this context.
     * @param {Array<{ name: string, value: string, url?: string }>} cookies
     */
    async setCookies(cookies) {
        await this._context.addCookies(cookies);
    }

    // ─── Lifecycle ─────────────────────────────────────────────────────────────

    /**
     * Close the context. Idempotent — safe to call multiple times.
     */
    async close() {
        if (this._closed) return;
        this._closed = true;
        try { await this._context.close(); } catch (_) {}
    }

    /**
     * Expose the raw Playwright context for any provider-specific operations.
     * @returns {import('playwright-core').BrowserContext}
     */
    get nativeContext() {
        return this._context;
    }
}

module.exports = PlaywrightContextAdapter;
