'use strict';

/**
 * SITAM Smart ERP — IPageAdapter
 *
 * Normalized interface for a single browser page/tab.
 * Wraps the provider-native page object so callers (erpBrowserService, page objects)
 * never touch Puppeteer or Playwright APIs directly.
 *
 * DIFFERENCES NORMALIZED BY THIS ADAPTER:
 *
 *   1. waitUntil string:
 *      Puppeteer  → 'networkidle2', 'networkidle0', 'domcontentloaded', 'load'
 *      Playwright → 'networkidle',  'domcontentloaded', 'load'
 *      Adapter    → maps 'networkidle2' / 'networkidle0' → 'networkidle' for Playwright
 *
 *   2. waitForFunction argument order:
 *      Puppeteer  → waitForFunction(fn, { timeout }, ...args)
 *      Playwright → waitForFunction(fn, arg, { timeout })
 *      Adapter    → always accepts Puppeteer order, re-maps internally for Playwright
 *
 *   3. setUserAgent / setViewport:
 *      Puppeteer  → page.setUserAgent(ua), page.setViewport({ w, h })
 *      Playwright → set on context.newContext({ userAgent, viewport }) — not on page
 *      Adapter    → no-ops on the page level; UA+viewport baked into context at creation
 *
 * Stable API exposed to callers:
 *   goto(url, opts)                        → void
 *   waitForSelector(selector, opts)        → void
 *   waitForFunction(fn, opts, ...args)     → any
 *   waitForNavigation(opts)                → void
 *   type(selector, text, opts)             → void
 *   click(selector)                        → void
 *   evaluate(fn, ...args)                  → any
 *   content()                              → string
 *   url()                                  → string
 *   close()                                → void
 */

class IPageAdapter {
    /**
     * Navigate to a URL.
     * @param {string} url
     * @param {{ waitUntil?: string, timeout?: number }} [opts]
     * @returns {Promise<void>}
     */
    async goto(url, opts = {}) {
        throw new Error('[IPageAdapter] goto() not implemented');
    }

    /**
     * Wait for a CSS selector to appear in the DOM.
     * @param {string} selector
     * @param {{ timeout?: number, visible?: boolean }} [opts]
     * @returns {Promise<void>}
     */
    async waitForSelector(selector, opts = {}) {
        throw new Error('[IPageAdapter] waitForSelector() not implemented');
    }

    /**
     * Wait for an in-page JS predicate to return truthy.
     * Uses Puppeteer argument order: (fn, opts, ...args)
     *
     * @param {Function|string} fn
     * @param {{ timeout?: number }} [opts]
     * @param {...any} args  - Arguments passed to fn inside the browser context
     * @returns {Promise<any>}
     */
    async waitForFunction(fn, opts = {}, ...args) {
        throw new Error('[IPageAdapter] waitForFunction() not implemented');
    }

    /**
     * Wait for a navigation to complete (page load, redirect, etc.).
     * @param {{ waitUntil?: string, timeout?: number }} [opts]
     * @returns {Promise<void>}
     */
    async waitForNavigation(opts = {}) {
        throw new Error('[IPageAdapter] waitForNavigation() not implemented');
    }

    /**
     * Type text into a focused element.
     * @param {string} selector
     * @param {string} text
     * @param {{ delay?: number }} [opts]
     * @returns {Promise<void>}
     */
    async type(selector, text, opts = {}) {
        throw new Error('[IPageAdapter] type() not implemented');
    }

    /**
     * Click an element.
     * @param {string} selector
     * @returns {Promise<void>}
     */
    async click(selector) {
        throw new Error('[IPageAdapter] click() not implemented');
    }

    /**
     * Execute a function in the page's JavaScript context.
     * @param {Function|string} fn
     * @param {...any} args
     * @returns {Promise<any>}
     */
    async evaluate(fn, ...args) {
        throw new Error('[IPageAdapter] evaluate() not implemented');
    }

    /**
     * Return the full outer HTML of the page.
     * @returns {Promise<string>}
     */
    async content() {
        throw new Error('[IPageAdapter] content() not implemented');
    }

    /**
     * Return the current page URL.
     * @returns {string}
     */
    url() {
        throw new Error('[IPageAdapter] url() not implemented');
    }

    /**
     * Close this page/tab.
     * Must be idempotent.
     * @returns {Promise<void>}
     */
    async close() {
        throw new Error('[IPageAdapter] close() not implemented');
    }
}

module.exports = IPageAdapter;
