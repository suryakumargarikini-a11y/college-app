'use strict';

/**
 * IncidentPredictionEngine.js
 * SITAM Smart ERP — AI-Ops Incident Prediction & Forecasting
 *
 * Models current metrics (CPU, latency, database connections, and error ratios) to
 * forecast potential service anomalies and calculate probability indexes of impending
 * outages or degradation.
 */

const logger = require('../../services/logger');

class IncidentPredictionEngine {
  constructor(options = {}) {
    this.metrics = options.metrics || null;
    this._initMetrics();
  }

  _initMetrics() {
    if (!this.metrics) return;
    try {
      const { Gauge } = require('prom-client');
      this.incidentProbabilityGauge = new Gauge({
        name: 'incident_prediction_probability',
        help: 'Estimated probability of an incident occurring (0-100)',
        labelNames: ['service'],
        registers: [this.metrics]
      });
    } catch (err) {
      logger.warn(`[IncidentPrediction] Failed to initialize metrics: ${err.message}`);
    }
  }

  predictIncidents(currentMetrics = {}) {
    logger.info('[IncidentPredictionEngine] Running anomaly forecasting and incident prediction model...');
    const predictions = [];

    const services = ['scraper', 'api', 'database', 'redis'];
    for (const service of services) {
      let probability = 5;

      if (service === 'scraper' && currentMetrics.scraperErrorRate > 0.05) {
        probability += (currentMetrics.scraperErrorRate * 100);
      }
      if (service === 'api' && currentMetrics.apiLatencyMs > 200) {
        probability += (currentMetrics.apiLatencyMs - 200) / 10;
      }
      if (service === 'database' && currentMetrics.dbConnectionCount > 90) {
        probability += (currentMetrics.dbConnectionCount - 90) * 8;
      }
      if (service === 'redis' && currentMetrics.redisMemoryRss > 200000000) {
        probability += 35;
      }

      probability = Math.min(100, Math.round(probability));
      
      if (this.incidentProbabilityGauge) {
        this.incidentProbabilityGauge.labels(service).set(probability);
      }

      predictions.push({
        service,
        probability,
        riskLevel: probability > 70 ? 'HIGH' : (probability > 35 ? 'MEDIUM' : 'LOW')
      });
    }

    const sorted = [...predictions].sort((a, b) => b.probability - a.probability);
    logger.info(`[IncidentPredictionEngine] Prediction run completed. Highest risk target: ${sorted[0].service} (${sorted[0].probability}%)`);
    return predictions;
  }
}

module.exports = IncidentPredictionEngine;
