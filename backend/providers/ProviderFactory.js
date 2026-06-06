/**
 * SITAM Smart ERP — Provider Factory
 *
 * Single source of truth for ERP provider instantiation.
 * Reads ERP_PROVIDER from environment and returns the correct singleton.
 *
 * SUPPORTED PROVIDERS:
 *   scraper       — SITAMScraperProvider (Puppeteer + Cheerio) [DEFAULT]
 *   official-api  — SITAMOfficialAPIProvider (REST API, future)
 *   mock          — MockERPProvider (deterministic test data)
 *
 * USAGE:
 *   const provider = ProviderFactory.getProvider();
 *   const result   = await provider.syncStudent(userId, password);
 *
 * SWITCHING PROVIDERS:
 *   Set ERP_PROVIDER env var and restart. Zero code changes in services.
 */

'use strict';

const logger = require('../services/logger');

// ─── Provider Registry ────────────────────────────────────────────────────────

const PROVIDER_MAP = {
    'scraper':      () => require('./scraper/SITAMScraperProvider'),
    'official-api': () => require('./api/SITAMOfficialAPIProvider'),
    'mock':         () => require('./mock/MockERPProvider'),
};

class ProviderFactory {
    constructor() {
        this._cached  = null;   // Active provider singleton
        this._override = null;  // Runtime override (for tests)
    }

    /**
     * Get the active ERP provider.
     * Provider is resolved from: runtime override → ERP_PROVIDER env → 'scraper' default.
     *
     * @returns {import('./interfaces/ERPProvider')}
     */
    getProvider() {
        if (this._cached) return this._cached;

        const name = this._override || process.env.ERP_PROVIDER || 'scraper';

        // Safety guard — mock provider only allowed outside production
        if (name === 'mock' && process.env.NODE_ENV === 'production') {
            logger.error('[ProviderFactory] CRITICAL: Mock provider cannot be used in production! Falling back to scraper.');
            this._cached = this._loadProvider('scraper');
            return this._cached;
        }

        if (!PROVIDER_MAP[name]) {
            logger.warn(`[ProviderFactory] Unknown provider "${name}", falling back to "scraper"`);
            this._cached = this._loadProvider('scraper');
        } else {
            this._cached = this._loadProvider(name);
        }

        logger.info(`[ProviderFactory] Active ERP provider: "${this._cached.providerName}"`);
        return this._cached;
    }

    /**
     * Override the active provider at runtime.
     * Useful in tests: ProviderFactory.setProvider('mock')
     *
     * @param {string} name - Provider name from PROVIDER_MAP
     */
    setProvider(name) {
        if (!PROVIDER_MAP[name]) {
            throw new Error(`[ProviderFactory] Unknown provider: "${name}". Valid options: ${Object.keys(PROVIDER_MAP).join(', ')}`);
        }
        if (name === 'mock' && process.env.NODE_ENV === 'production') {
            throw new Error('[ProviderFactory] Cannot use mock provider in production');
        }
        this._override = name;
        this._cached   = null; // Force reload on next getProvider()
        logger.info(`[ProviderFactory] Provider overridden to: "${name}"`);
    }

    /**
     * Reset to environment-default provider.
     * Call in test teardown: ProviderFactory.resetProvider()
     */
    resetProvider() {
        this._override = null;
        this._cached   = null;
        logger.info('[ProviderFactory] Provider reset to environment default');
    }

    /**
     * Get the name of the currently configured provider without instantiating it.
     * @returns {string}
     */
    getProviderName() {
        return this._override || process.env.ERP_PROVIDER || 'scraper';
    }

    /**
     * Check if a named provider is registered and available.
     * @param {string} name
     * @returns {boolean}
     */
    isProviderAvailable(name) {
        return !!PROVIDER_MAP[name];
    }

    /**
     * List all registered provider names.
     * @returns {string[]}
     */
    listProviders() {
        return Object.keys(PROVIDER_MAP);
    }

    // ─── Internal ────────────────────────────────────────────────────────────────

    _loadProvider(name) {
        try {
            const loader = PROVIDER_MAP[name];
            return loader();
        } catch (err) {
            logger.error(`[ProviderFactory] Failed to load provider "${name}": ${err.message}`);
            if (name !== 'scraper') {
                logger.info('[ProviderFactory] Falling back to scraper provider');
                return PROVIDER_MAP['scraper']();
            }
            throw err;
        }
    }
}

// Singleton factory — shared across the entire process
module.exports = new ProviderFactory();
