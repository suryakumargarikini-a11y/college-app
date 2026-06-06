/**
 * SITAM Smart ERP — Scraper Reliability Forecaster
 *
 * Uses rolling telemetry to predict instability BEFORE it causes incidents.
 * Moves scraping operations from reactive to predictive reliability engineering.
 *
 * FORECASTS:
 *   - CAPTCHA spike probability (next 30 minutes)
 *   - Selector drift probability (based on recent fallback depth trend)
 *   - ERP outage probability (based on latency + error rate trend)
 *   - Browser crash trend (based on recent crash frequency)
 *   - Sync backlog growth (based on queue depth vs. throughput)
 *
 * ALGORITHM:
 *   - Maintains 5-minute buckets of key metrics (last 12 buckets = 60 min of history)
 *   - Linear regression trend line on each metric
 *   - If trend slope is significantly positive → elevated probability forecast
 *
 * EMITS:
 *   - scraper_reliability_forecast_score (Prometheus gauge)
 *   - predicted_captcha_risk (Prometheus gauge, 0–100)
 *   - predicted_outage_probability (Prometheus gauge, 0–100)
 */

'use strict';

const logger = require('../../../services/logger');

const BUCKET_COUNT = 12;    // 12 × 5-min buckets = 60 min history
const BUCKET_MS    = 5 * 60 * 1000; // 5 minutes

class ScraperReliabilityForecaster {
    constructor() {
        this._buckets = this._initBuckets();
        this._currentBucket = 0;
        this._lastBucketStart = Date.now();
        this._forecastTimer = null;
        this._lastForecast  = this._emptyForecast();
    }

    /**
     * Start periodic forecasting (every 5 minutes).
     */
    startPeriodicForecasting() {
        if (this._forecastTimer) return;
        this._forecastTimer = setInterval(() => {
            this._rotateBucket();
            const forecast = this.forecast();
            this._emitForecastMetrics(forecast);
            if (forecast.overallRisk > 60) {
                logger.warn(`[Forecaster] Elevated risk detected — overall: ${forecast.overallRisk}%, CAPTCHA: ${forecast.captchaRisk}%, outage: ${forecast.outageRisk}%`);
            }
        }, BUCKET_MS);
    }

    stopPeriodicForecasting() {
        if (this._forecastTimer) { clearInterval(this._forecastTimer); this._forecastTimer = null; }
    }

    // ─── Event Recording ──────────────────────────────────────────────────────

    recordCaptchaHit()        { this._currentB().captchaHits++;   }
    recordSyncAttempt()       { this._currentB().syncAttempts++;  }
    recordSyncFailure()       { this._currentB().syncFailures++;  }
    recordSelectorFallback()  { this._currentB().selectorFails++; }
    recordBrowserCrash()      { this._currentB().browserCrashes++; }
    recordHighLatency(ms)     { if (ms > 30000) this._currentB().highLatencyEvents++; }
    recordQueueDepth(depth)   { this._currentB().queueDepthSamples.push(depth); }

    // ─── Forecasting ──────────────────────────────────────────────────────────

    /**
     * Compute reliability forecast from rolling history.
     *
     * @returns {ForecastResult}
     */
    forecast() {
        const history = this._getHistory();

        const captchaRisk   = this._forecastCaptchaRisk(history);
        const selectorRisk  = this._forecastSelectorDriftRisk(history);
        const outageRisk    = this._forecastOutageRisk(history);
        const crashTrend    = this._forecastCrashTrend(history);
        const backlogRisk   = this._forecastBacklogRisk(history);

        // Weighted composite (CAPTCHA and outage are highest weight)
        const overallRisk = Math.round(
            captchaRisk  * 0.30 +
            outageRisk   * 0.30 +
            selectorRisk * 0.15 +
            crashTrend   * 0.15 +
            backlogRisk  * 0.10
        );

        const reliabilityScore = Math.max(0, 100 - overallRisk);

        this._lastForecast = {
            reliabilityScore,
            overallRisk,
            captchaRisk,
            selectorRisk,
            outageRisk,
            crashTrend,
            backlogRisk,
            recommendation: this._getRecommendation(overallRisk),
            forecastedAt:   new Date().toISOString(),
            historyBuckets: history.length
        };

        return this._lastForecast;
    }

    /**
     * Get the last computed forecast (cached, no recalculation).
     */
    getLastForecast() {
        return this._lastForecast;
    }

    /**
     * Is the current risk elevated enough to warrant preemptive action?
     *
     * @param {string} [riskType] - 'captcha'|'outage'|'overall'
     * @returns {boolean}
     */
    isRiskElevated(riskType = 'overall') {
        const f = this._lastForecast;
        const thresholds = { captcha: 50, outage: 40, overall: 55 };
        return (f[`${riskType}Risk`] || f.overallRisk) >= (thresholds[riskType] || 55);
    }

    // ─── Private Forecasting Algorithms ──────────────────────────────────────

    _forecastCaptchaRisk(history) {
        if (history.length < 2) return 0;
        const rates = history.map(b => b.syncAttempts > 0 ? b.captchaHits / b.syncAttempts : 0);
        const trend = this._linearTrendSlope(rates);
        const recent = rates.slice(-3).reduce((a, b) => a + b, 0) / 3;
        // Risk = recent rate * 200 (so 50% CAPTCHA rate → 100%) + trend amplification
        return Math.min(100, Math.round(recent * 200 + Math.max(0, trend * 500)));
    }

    _forecastSelectorDriftRisk(history) {
        if (history.length < 2) return 0;
        const rates = history.map(b => b.syncAttempts > 0 ? b.selectorFails / b.syncAttempts : 0);
        const trend = this._linearTrendSlope(rates);
        const recent = rates.slice(-3).reduce((a, b) => a + b, 0) / 3;
        return Math.min(100, Math.round(recent * 300 + Math.max(0, trend * 600)));
    }

    _forecastOutageRisk(history) {
        if (history.length < 2) return 0;
        const failRates  = history.map(b => b.syncAttempts > 0 ? b.syncFailures / b.syncAttempts : 0);
        const latencies  = history.map(b => b.highLatencyEvents);
        const failTrend  = this._linearTrendSlope(failRates);
        const recentFail = failRates.slice(-3).reduce((a, b) => a + b, 0) / 3;
        const recentLat  = latencies.slice(-3).reduce((a, b) => a + b, 0) / 3;
        return Math.min(100, Math.round(recentFail * 150 + recentLat * 10 + Math.max(0, failTrend * 300)));
    }

    _forecastCrashTrend(history) {
        if (history.length < 2) return 0;
        const crashes = history.map(b => b.browserCrashes);
        const trend   = this._linearTrendSlope(crashes);
        const recent  = crashes.slice(-3).reduce((a, b) => a + b, 0);
        return Math.min(100, Math.round(recent * 15 + Math.max(0, trend * 100)));
    }

    _forecastBacklogRisk(history) {
        if (history.length < 2) return 0;
        const depths = history.map(b => {
            const samples = b.queueDepthSamples;
            return samples.length > 0 ? samples.reduce((a, c) => a + c, 0) / samples.length : 0;
        });
        const trend   = this._linearTrendSlope(depths);
        const recent  = depths.slice(-3).reduce((a, b) => a + b, 0) / 3;
        return Math.min(100, Math.round(recent * 2 + Math.max(0, trend * 50)));
    }

    /**
     * Compute linear trend slope using least-squares regression.
     * Returns positive slope (growing), negative (declining), or 0.
     */
    _linearTrendSlope(values) {
        const n = values.length;
        if (n < 2) return 0;

        const xMean = (n - 1) / 2;
        const yMean = values.reduce((a, b) => a + b, 0) / n;

        let numerator   = 0;
        let denominator = 0;
        for (let i = 0; i < n; i++) {
            numerator   += (i - xMean) * (values[i] - yMean);
            denominator += (i - xMean) ** 2;
        }

        return denominator === 0 ? 0 : numerator / denominator;
    }

    _getRecommendation(risk) {
        if (risk >= 80) return 'EMERGENCY: Pause all syncs immediately, investigate ERP access';
        if (risk >= 60) return 'HIGH: Switch to PROTECTED mode, alert on-call SRE';
        if (risk >= 40) return 'ELEVATED: Reduce concurrency, monitor closely';
        if (risk >= 20) return 'MODERATE: Continue with reduced batch sizes';
        return 'NORMAL: No action required';
    }

    _rotateBucket() {
        this._currentBucket = (this._currentBucket + 1) % BUCKET_COUNT;
        this._buckets[this._currentBucket] = this._emptyBucket();
        this._lastBucketStart = Date.now();
    }

    _currentB() { return this._buckets[this._currentBucket]; }

    _getHistory() {
        // Return buckets in chronological order (excluding current partial bucket)
        const completed = [];
        for (let i = 1; i < BUCKET_COUNT; i++) {
            const idx = (this._currentBucket - i + BUCKET_COUNT) % BUCKET_COUNT;
            completed.unshift(this._buckets[idx]);
        }
        return completed;
    }

    _initBuckets() {
        return Array.from({ length: BUCKET_COUNT }, () => this._emptyBucket());
    }

    _emptyBucket() {
        return { captchaHits: 0, syncAttempts: 0, syncFailures: 0,
                 selectorFails: 0, browserCrashes: 0, highLatencyEvents: 0,
                 queueDepthSamples: [] };
    }

    _emptyForecast() {
        return { reliabilityScore: 100, overallRisk: 0, captchaRisk: 0,
                 selectorRisk: 0, outageRisk: 0, crashTrend: 0, backlogRisk: 0,
                 recommendation: 'NORMAL: No action required', forecastedAt: null };
    }

    _emitForecastMetrics(forecast) {
        try {
            const m = require('../../telemetry/ProviderMetrics');
            m.setForecastScore('sitam-scraper', forecast.reliabilityScore);
            m.setForecastCaptchaRisk('sitam-scraper', forecast.captchaRisk);
            m.setForecastOutageRisk('sitam-scraper', forecast.outageRisk);
        } catch (_) {}
    }
}

module.exports = new ScraperReliabilityForecaster();
