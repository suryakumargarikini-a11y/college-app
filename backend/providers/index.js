/**
 * SITAM Smart ERP — Providers Barrel Export
 *
 * Single import point for the entire provider system.
 * Consumers should import from here rather than deep-requiring individual files.
 *
 * USAGE:
 *   const { ProviderFactory, ERPProvider, errors } = require('../providers');
 *   const provider = ProviderFactory.getProvider();
 *   const result = await provider.syncStudent(userId, password);
 */

'use strict';

module.exports = {
    // Factory — get the active provider
    ProviderFactory: require('./ProviderFactory'),

    // Interface — base class for all providers
    ERPProvider: require('./interfaces/ERPProvider'),

    // Error types — classify and handle provider failures
    errors: require('./errors'),

    // Provider implementations (rarely needed directly — use ProviderFactory)
    providers: {
        scraper:     require('./scraper/SITAMScraperProvider'),
        officialApi: require('./api/SITAMOfficialAPIProvider'),
        mock:        require('./mock/MockERPProvider')
    },

    // Session management
    sessionManager: require('./session/ProviderSessionManager'),

    // Provider-specific metrics
    metrics: require('./telemetry/ProviderMetrics')
};
