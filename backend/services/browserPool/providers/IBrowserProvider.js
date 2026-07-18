'use strict';

/**
 * SITAM Smart ERP — IBrowserProvider
 *
 * Abstract contract that every browser automation provider must satisfy.
 * BrowserInstance delegates all browser-level operations to a provider;
 * BrowserPool and everything above it remain provider-agnostic.
 *
 * SUPPORTED PROVIDERS (configured via BROWSER_PROVIDER env var):
 *   PUPPETEER   — PuppeteerProvider  (default, current production driver)
 *   PLAYWRIGHT  — PlaywrightProvider (migration target)
 *
 * FUTURE PROVIDERS (drop-in, no BrowserPool changes required):
 *   PLAYWRIGHT_FIREFOX — Playwright with Firefox
 *   PLAYWRIGHT_WEBKIT  — Playwright with WebKit
 *   REMOTE             — Remote CDP endpoint (Browserless, Browserbase, Steel)
 *
 * DESIGN CONTRACT:
 *   - launch()         → starts the underlying browser process
 *   - createContext()  → returns an IContextAdapter (isolated session)
 *   - isConnected()    → SYNCHRONOUS health check (no async RPC)
 *   - on()             → forwards browser-level events (e.g. 'disconnected')
 *   - close()          → shuts down the browser process cleanly
 *   - process()        → returns the ChildProcess for PID tracking
 *   - getVersion()     → async version string for diagnostics
 *
 * All implementations MUST NOT throw from isConnected() — it is called on
 * the hot path before every context checkout.
 */

const logger = require('../../logger');

class IBrowserProvider {
    /**
     * Human-readable provider name for logs and metrics.
     * Override in each concrete provider.
     * @type {string}
     */
    get name() {
        return 'abstract';
    }

    // ─── Lifecycle ─────────────────────────────────────────────────────────────

    /**
     * Start the browser process and prepare it to accept contexts.
     * Must be called before any other method.
     *
     * @param {string|undefined|null} executablePath  - Path to Chromium binary.
     *        undefined/null → let the provider auto-discover (e.g. Playwright bundled).
     * @param {string[]} launchArgs  - Additional Chromium CLI flags.
     * @returns {Promise<void>}
     */
    async launch(executablePath, launchArgs) {
        throw new Error(`[${this.name}] launch() not implemented`);
    }

    /**
     * Create an isolated browser context (incognito session).
     * Returns an IContextAdapter wrapping the provider's native context.
     *
     * @param {string} userAgent   - Stealth UA string for this context.
     * @param {{ width: number, height: number }} viewport
     * @returns {Promise<import('./adapters/IContextAdapter')>}
     */
    async createContext(userAgent, viewport) {
        throw new Error(`[${this.name}] createContext() not implemented`);
    }

    /**
     * Close the browser process and release all resources.
     * Must be idempotent — safe to call multiple times.
     * @returns {Promise<void>}
     */
    async close() {
        throw new Error(`[${this.name}] close() not implemented`);
    }

    // ─── State / Health ────────────────────────────────────────────────────────

    /**
     * SYNCHRONOUS health check.
     * Returns true if the browser process WebSocket is still live.
     * MUST NOT throw. MUST NOT make async RPC calls.
     *
     * @returns {boolean}
     */
    isConnected() {
        return false;
    }

    /**
     * Retrieve the browser version string for diagnostics.
     * May be cached after first call.
     *
     * @returns {Promise<string>}
     */
    async getVersion() {
        return 'unknown';
    }

    /**
     * Return the underlying ChildProcess for PID tracking.
     * Returns null if the process is not accessible (e.g. remote provider).
     *
     * @returns {import('child_process').ChildProcess | null}
     */
    process() {
        return null;
    }

    // ─── Events ────────────────────────────────────────────────────────────────

    /**
     * Register a listener on a browser-level event.
     * Required event: 'disconnected' — fired when the browser process dies.
     *
     * @param {string}   event
     * @param {Function} callback
     */
    on(event, callback) {
        logger.warn(`[${this.name}] on('${event}') not implemented`);
    }
}

module.exports = IBrowserProvider;
