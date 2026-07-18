'use strict';

/**
 * SITAM Smart ERP — IContextAdapter
 *
 * Normalized interface for an isolated browser context (incognito session).
 * Wraps the provider-native context object so callers never touch Puppeteer or
 * Playwright APIs directly.
 *
 * DIFFERENCE BETWEEN PROVIDERS:
 *   Puppeteer : context = Browser.createBrowserContext()
 *               cookies set via context.setCookie(...spread)
 *               cookies read via page.cookies()
 *
 *   Playwright: context = browser.newContext({ userAgent, viewport })
 *               cookies set via context.addCookies(array)
 *               cookies read via context.cookies()
 *
 * This adapter exposes a single, stable API — callers use:
 *   context.newPage()          → IPageAdapter
 *   context.setCookies(arr)    → void
 *   context.getCookies()       → {name,value,...}[]
 *   context.close()            → void
 */

class IContextAdapter {
    /**
     * Create a new page inside this context.
     * Returns an IPageAdapter that normalizes incompatible page-level APIs.
     *
     * @returns {Promise<import('./IPageAdapter')>}
     */
    async newPage() {
        throw new Error('[IContextAdapter] newPage() not implemented');
    }

    /**
     * Set one or more cookies in this context.
     * Accepts a standard array of cookie objects — no spread needed.
     *
     * @param {{ name: string, value: string, domain?: string, path?: string, httpOnly?: boolean, secure?: boolean, sameSite?: string }[]} cookies
     * @returns {Promise<void>}
     */
    async setCookies(cookies) {
        throw new Error('[IContextAdapter] setCookies() not implemented');
    }

    /**
     * Retrieve all cookies currently set in this context.
     *
     * @returns {Promise<{ name: string, value: string, domain: string, path: string }[]>}
     */
    async getCookies() {
        throw new Error('[IContextAdapter] getCookies() not implemented');
    }

    /**
     * Close this context and release all associated resources (pages, storage, cookies).
     * Must be idempotent — safe to call on an already-closed context.
     *
     * @returns {Promise<void>}
     */
    async close() {
        throw new Error('[IContextAdapter] close() not implemented');
    }
}

module.exports = IContextAdapter;
