'use strict';

/**
 * SITAM Smart ERP — Browser Provider Factory
 *
 * Single source of truth for selecting the browser automation provider.
 * Read once at module load. Restart required to change provider.
 *
 * CONFIGURATION:
 *   BROWSER_PROVIDER=PUPPETEER   → PuppeteerProvider  (default)
 *   BROWSER_PROVIDER=PLAYWRIGHT  → PlaywrightProvider  (Loop 2)
 *
 * USAGE:
 *   const { createProvider } = require('./providerFactory');
 *   const provider = createProvider();    // new instance each call
 *
 *   const { createStandaloneBrowser } = require('./providerFactory');
 *   const { browser, close } = await createStandaloneBrowser({ headless });
 *   // ... do work ...
 *   await close();
 *
 * FUTURE PROVIDERS — add to PROVIDER_MAP and implement IBrowserProvider:
 *   PLAYWRIGHT_FIREFOX
 *   PLAYWRIGHT_WEBKIT
 *   REMOTE   (Browserless, Browserbase, Steel)
 */

const logger = require('../../logger');

const PROVIDER_MAP = {
    PLAYWRIGHT: () => require('./PlaywrightProvider'),
};

/**
 * Create a fresh provider instance (not shared — BrowserInstance owns its own).
 * @returns {import('./IBrowserProvider')}
 */
function createProvider() {
    const name = (process.env.BROWSER_PROVIDER || 'PLAYWRIGHT').toUpperCase();
    const loader = PROVIDER_MAP[name];

    if (!loader) {
        throw new Error(
            `[ProviderFactory] Unknown BROWSER_PROVIDER="${name}". ` +
            `Valid options: ${Object.keys(PROVIDER_MAP).join(', ')}`
        );
    }

    try {
        const ProviderClass = loader();
        const instance = new ProviderClass();
        logger.debug(`[ProviderFactory] Created ${instance.name} provider`);
        return instance;
    } catch (err) {
        throw err;
    }
}

/**
 * Get the configured provider name without instantiating it.
 * @returns {string}
 */
function getProviderName() {
    return (process.env.BROWSER_PROVIDER || 'PLAYWRIGHT').toUpperCase();
}

/**
 * Launch a short-lived standalone browser for one-off operations
 * (startup validation, openPaymentWindow, scripts).
 * Returns { provider, close } — caller MUST call close() when done.
 *
 * @param {{ headless?: boolean, executablePath?: string }} [opts]
 * @returns {Promise<{ provider: import('./IBrowserProvider'), close: Function }>}
 */
async function createStandaloneBrowser(opts = {}) {
    const { findChromiumExecutable } = require('../chromiumFinder');

    const executablePath = opts.executablePath || findChromiumExecutable() || undefined;
    const provider = createProvider();

    const launchArgs = [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
    ];

    // Headed mode: only on non-production non-Linux (e.g. local Windows dev)
    // Playwright / Puppeteer both accept headless:false
    if (opts.headless === false) {
        launchArgs.push('--start-maximized');
    }

    await provider.launch(executablePath, launchArgs);
    logger.info(`[ProviderFactory] Standalone browser launched (${provider.name}, headless=${opts.headless !== false})`);

    return {
        provider,
        close: async () => {
            try { await provider.close(); } catch (_) {}
        },
    };
}

module.exports = { createProvider, getProviderName, createStandaloneBrowser };
