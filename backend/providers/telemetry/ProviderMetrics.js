/**
 * SITAM Smart ERP — Provider Telemetry & Health Metrics
 *
 * Prometheus metrics specifically for monitoring ERP provider performance,
 * selector health, CAPTCHA frequency, and sync reliability.
 * These metrics are registered on the shared prom-client registry so they
 * appear in /api/metrics alongside all other platform metrics.
 */

'use strict';

const logger = require('../../services/logger');

class ProviderMetrics {
    constructor() {
        this._initialized = false;
        this.metrics = {};
    }

    /**
     * Lazy initialization — only registers counters/histograms if prom-client is available.
     * Silently skips if metrics service is not ready (e.g. during testing).
     */
    _ensureInitialized() {
        if (this._initialized) return;
        this._initialized = true;

        try {
            const client = require('prom-client');

            // ── Request counters ─────────────────────────────────────────────
            this.metrics.requestsTotal = new client.Counter({
                name: 'erp_provider_requests_total',
                help: 'Total ERP provider requests by method and outcome',
                labelNames: ['provider', 'method', 'status']
            });

            // ── Duration histogram ───────────────────────────────────────────
            this.metrics.durationSeconds = new client.Histogram({
                name: 'erp_provider_duration_seconds',
                help: 'ERP provider operation duration in seconds',
                labelNames: ['provider', 'method'],
                buckets: [0.5, 1, 2, 5, 10, 20, 30, 60]
            });

            // ── Selector drift counter ───────────────────────────────────────
            this.metrics.selectorFailuresTotal = new client.Counter({
                name: 'erp_selector_failures_total',
                help: 'Number of CSS selector failures indicating DOM drift',
                labelNames: ['provider', 'selector', 'page']
            });

            // ── CAPTCHA detection counter ────────────────────────────────────
            this.metrics.captchaDetectionsTotal = new client.Counter({
                name: 'erp_captcha_detections_total',
                help: 'Number of CAPTCHA pages detected by the scraper provider',
                labelNames: ['provider']
            });

            // ── Session refresh counter ──────────────────────────────────────
            this.metrics.sessionRefreshesTotal = new client.Counter({
                name: 'erp_session_refreshes_total',
                help: 'Number of ERP session refreshes (re-logins) performed',
                labelNames: ['provider', 'reason']
            });

            // ── DOM drift incidents ──────────────────────────────────────────
            this.metrics.domDriftIncidentsTotal = new client.Counter({
                name: 'erp_dom_drift_incidents_total',
                help: 'Number of ERP DOM layout drift incidents detected',
                labelNames: ['provider', 'page']
            });

            // ── Sync success rate ────────────────────────────────────────────
            this.metrics.syncSuccessTotal = new client.Counter({
                name: 'erp_sync_success_total',
                help: 'Total successful ERP data synchronizations',
                labelNames: ['provider', 'syncType']
            });

            this.metrics.syncFailureTotal = new client.Counter({
                name: 'erp_sync_failure_total',
                help: 'Total failed ERP data synchronizations',
                labelNames: ['provider', 'syncType', 'errorType']
            });

            // ── Provider health gauge ────────────────────────────────────────
            this.metrics.providerHealthScore = new client.Gauge({
                name: 'erp_provider_health_score',
                help: 'ERP provider health score 0-100 (100 = fully healthy)',
                labelNames: ['provider']
            });

            // ── Fallback chain depth ─────────────────────────────────────────
            this.metrics.selectorFallbackDepth = new client.Histogram({
                name: 'erp_selector_fallback_depth',
                help: 'Number of selector fallbacks attempted before success or failure',
                labelNames: ['provider', 'page'],
                buckets: [0, 1, 2, 3, 4, 5]
            });

            // ── Anti-bot events ──────────────────────────────────────────────
            this.metrics.antiBotEventsTotal = new client.Counter({
                name: 'erp_antibot_events_total',
                help: 'Anti-bot challenges detected (CAPTCHA, Cloudflare, blocked, etc.)',
                labelNames: ['provider', 'type']
            });

            // ── DOM Drift score histogram ────────────────────────────────────
            this.metrics.domDriftScore = new client.Histogram({
                name: 'erp_dom_drift_score',
                help: 'DOM structural drift score per page (0=identical, 100=redesigned)',
                labelNames: ['provider', 'page'],
                buckets: [0, 5, 15, 30, 50, 75, 100]
            });

            // ── Retry attempts ───────────────────────────────────────────────
            this.metrics.retryAttemptsTotal = new client.Counter({
                name: 'erp_retry_attempts_total',
                help: 'Retry attempts by error type and action taken',
                labelNames: ['provider', 'errorType', 'action']
            });

            // ── Sync deduplication ───────────────────────────────────────────
            this.metrics.syncDedupHitsTotal = new client.Counter({
                name: 'erp_sync_dedup_hits_total',
                help: 'Number of sync requests deduplicated (already-in-progress)',
                labelNames: ['provider']
            });

            // ── Partial sync recovery ────────────────────────────────────────
            this.metrics.partialSyncRecoveryTotal = new client.Counter({
                name: 'erp_partial_sync_recovery_total',
                help: 'Number of partial sync checkpoints resumed',
                labelNames: ['provider', 'event']
            });

            // ── Browser reputation ───────────────────────────────────────────
            this.metrics.browserReputationScore = new client.Gauge({
                name: 'erp_browser_reputation_score',
                help: 'Trust score for each browser instance (0-100)',
                labelNames: ['browserId']
            });

            this.metrics.browserQuarantinesTotal = new client.Counter({
                name: 'erp_browser_quarantine_total',
                help: 'Number of browser instances quarantined due to low trust score',
                labelNames: ['provider']
            });

            this.metrics.browserRetirementsTotal = new client.Counter({
                name: 'erp_browser_retirements_total',
                help: 'Number of browser instances retired from pool',
                labelNames: ['provider']
            });

            // ── Maintenance mode ─────────────────────────────────────────────
            this.metrics.maintenanceModeTotal = new client.Counter({
                name: 'erp_maintenance_mode_total',
                help: 'Number of ERP maintenance mode detections',
                labelNames: ['provider', 'severity']
            });

            // ── Load shedding ────────────────────────────────────────────────
            this.metrics.loadSheddingModeGauge = new client.Gauge({
                name: 'erp_load_shedding_mode',
                help: 'Current load shedding mode (0=NORMAL,1=DEGRADED,2=PROTECTED,3=EMERGENCY)',
                labelNames: ['provider']
            });

            // ── Queue pressure ───────────────────────────────────────────────
            this.metrics.queuePressureLevelGauge = new client.Gauge({
                name: 'erp_queue_pressure_level',
                help: 'Current queue pressure level (0=NORMAL,1=ELEVATED,2=HIGH,3=CRITICAL)',
                labelNames: ['provider']
            });

            // ── Selector optimization ────────────────────────────────────────
            this.metrics.selectorPromotionsTotal = new client.Counter({
                name: 'erp_selector_promotions_total',
                help: 'Number of selector promotions from fallback to primary',
                labelNames: ['provider', 'selectorKey', 'depth']
            });

            // ── Reliability forecast ─────────────────────────────────────────
            this.metrics.forecastReliabilityScore = new client.Gauge({
                name: 'erp_forecast_reliability_score',
                help: 'Predicted reliability score for next 30 minutes (0-100)',
                labelNames: ['provider']
            });

            this.metrics.forecastCaptchaRisk = new client.Gauge({
                name: 'erp_forecast_captcha_risk',
                help: 'Predicted CAPTCHA spike probability (0-100)',
                labelNames: ['provider']
            });

            this.metrics.forecastOutageRisk = new client.Gauge({
                name: 'erp_forecast_outage_risk',
                help: 'Predicted ERP outage probability (0-100)',
                labelNames: ['provider']
            });

            // ── Page scrape duration ─────────────────────────────────────────
            this.metrics.pageScrapeDuration = new client.Histogram({
                name: 'erp_page_scrape_duration_seconds',
                help: 'Duration of individual ERP page scraping operations',
                labelNames: ['provider', 'page'],
                buckets: [1, 3, 5, 10, 20, 30, 60]
            });

            logger.info('[ProviderMetrics] Provider Prometheus metrics registered successfully (extended).');
        } catch (err) {
            logger.warn(`[ProviderMetrics] Could not register provider metrics (prom-client unavailable): ${err.message}`);
        }
    }

    /**
     * Record a completed provider operation.
     * @param {string} provider
     * @param {string} method
     * @param {'success'|'error'|'timeout'} status
     * @param {number} durationMs
     */
    recordOperation(provider, method, status, durationMs) {
        this._ensureInitialized();
        try {
            this.metrics.requestsTotal?.inc({ provider, method, status });
            this.metrics.durationSeconds?.observe({ provider, method }, durationMs / 1000);
        } catch (_) {}
    }

    /**
     * Record a CSS selector failure (DOM drift indicator).
     * @param {string} provider
     * @param {string} selector
     * @param {string} page
     */
    recordSelectorFailure(provider, selector, page) {
        this._ensureInitialized();
        try {
            this.metrics.selectorFailuresTotal?.inc({ provider, selector: selector.substring(0, 50), page });
            this.metrics.domDriftIncidentsTotal?.inc({ provider, page });
        } catch (_) {}
    }

    /**
     * Record a CAPTCHA detection event.
     * @param {string} provider
     */
    recordCaptchaDetection(provider) {
        this._ensureInitialized();
        try {
            this.metrics.captchaDetectionsTotal?.inc({ provider });
        } catch (_) {}
    }

    /**
     * Record a session refresh (re-login).
     * @param {string} provider
     * @param {'expired'|'invalid'|'proactive'} reason
     */
    recordSessionRefresh(provider, reason) {
        this._ensureInitialized();
        try {
            this.metrics.sessionRefreshesTotal?.inc({ provider, reason });
        } catch (_) {}
    }

    /**
     * Record a selector fallback depth (0 = first selector worked, N = Nth fallback used).
     * @param {string} provider
     * @param {string} page
     * @param {number} depth
     */
    recordSelectorFallbackDepth(provider, page, depth) {
        this._ensureInitialized();
        try {
            this.metrics.selectorFallbackDepth?.observe({ provider, page }, depth);
        } catch (_) {}
    }

    /**
     * Update the provider health score gauge.
     * @param {string} provider
     * @param {number} score - 0 to 100
     */
    setHealthScore(provider, score) {
        this._ensureInitialized();
        try {
            this.metrics.providerHealthScore?.set({ provider }, Math.max(0, Math.min(100, score)));
        } catch (_) {}
    }

    /**
     * Record a successful full or incremental sync.
     * @param {string} provider
     * @param {'full'|'incremental'} syncType
     */
    recordSyncSuccess(provider, syncType) {
        this._ensureInitialized();
        try {
            this.metrics.syncSuccessTotal?.inc({ provider, syncType });
        } catch (_) {}
    }

    /**
     * Record a failed sync.
     */
    recordSyncFailure(provider, syncType, errorType) {
        this._ensureInitialized();
        try {
            this.metrics.syncFailureTotal?.inc({ provider, syncType, errorType });
        } catch (_) {}
    }

    // ─── Phase 1 & 2 Hardening Recording Methods ─────────────────────────────

    recordAntiBotEvent(provider, type) {
        this._ensureInitialized();
        try {
            this.metrics.antiBotEventsTotal?.inc({ provider, type });
            this.metrics.captchaDetectionsTotal?.inc({ provider });
        } catch (_) {}
    }

    recordDOMDrift(provider, page, score) {
        this._ensureInitialized();
        try {
            this.metrics.domDriftScore?.observe({ provider, page }, score);
            this.metrics.domDriftIncidentsTotal?.inc({ provider, page });
        } catch (_) {}
    }

    recordRetryAttempt(provider, errorType, action) {
        this._ensureInitialized();
        try {
            this.metrics.retryAttemptsTotal?.inc({ provider, errorType, action });
        } catch (_) {}
    }

    recordSyncDedupHit(provider) {
        this._ensureInitialized();
        try {
            this.metrics.syncDedupHitsTotal?.inc({ provider });
        } catch (_) {}
    }

    recordPartialSyncRecovery(provider, event) {
        this._ensureInitialized();
        try {
            this.metrics.partialSyncRecoveryTotal?.inc({ provider, event });
        } catch (_) {}
    }

    setBrowserReputationScore(browserId, score) {
        this._ensureInitialized();
        try {
            this.metrics.browserReputationScore?.set({ browserId }, Math.max(0, Math.min(100, score)));
        } catch (_) {}
    }

    recordBrowserQuarantine(provider) {
        this._ensureInitialized();
        try {
            this.metrics.browserQuarantinesTotal?.inc({ provider });
        } catch (_) {}
    }

    recordBrowserRetirement(provider) {
        this._ensureInitialized();
        try {
            this.metrics.browserRetirementsTotal?.inc({ provider });
        } catch (_) {}
    }

    recordMaintenanceMode(provider, severity) {
        this._ensureInitialized();
        try {
            this.metrics.maintenanceModeTotal?.inc({ provider, severity });
        } catch (_) {}
    }

    recordLoadSheddingMode(provider, mode) {
        this._ensureInitialized();
        try {
            const modeValue = { NORMAL: 0, DEGRADED: 1, PROTECTED: 2, EMERGENCY: 3 }[mode] ?? 0;
            this.metrics.loadSheddingModeGauge?.set({ provider }, modeValue);
        } catch (_) {}
    }

    recordQueuePressureLevel(provider, level) {
        this._ensureInitialized();
        try {
            const levelValue = { NORMAL: 0, ELEVATED: 1, HIGH: 2, CRITICAL: 3 }[level] ?? 0;
            this.metrics.queuePressureLevelGauge?.set({ provider }, levelValue);
        } catch (_) {}
    }

    recordSelectorPromotion(provider, selectorKey, depth) {
        this._ensureInitialized();
        try {
            this.metrics.selectorPromotionsTotal?.inc({ provider, selectorKey, depth: String(depth) });
        } catch (_) {}
    }

    setForecastScore(provider, score) {
        this._ensureInitialized();
        try {
            this.metrics.forecastReliabilityScore?.set({ provider }, Math.max(0, Math.min(100, score)));
        } catch (_) {}
    }

    setForecastCaptchaRisk(provider, risk) {
        this._ensureInitialized();
        try {
            this.metrics.forecastCaptchaRisk?.set({ provider }, Math.max(0, Math.min(100, risk)));
        } catch (_) {}
    }

    setForecastOutageRisk(provider, risk) {
        this._ensureInitialized();
        try {
            this.metrics.forecastOutageRisk?.set({ provider }, Math.max(0, Math.min(100, risk)));
        } catch (_) {}
    }

    observePageScrapeDuration(provider, page, durationMs) {
        this._ensureInitialized();
        try {
            this.metrics.pageScrapeDuration?.observe({ provider, page }, durationMs / 1000);
        } catch (_) {}
    }
}

// Singleton shared across all providers
module.exports = new ProviderMetrics();

