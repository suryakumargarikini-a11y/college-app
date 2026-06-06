'use strict';

/**
 * BusinessMetricsCollector.js
 * SITAM Smart ERP — Business Metrics Collection
 *
 * Collects product-level KPIs (Daily/Monthly Active Users using Redis HyperLogLog,
 * sync volumes, feature adoption rates, and user retention). Updates gauges and
 * counters for Grafana and Prometheus.
 */

const redisService = require('../../services/redisService');
const logger = require('../../services/logger');

class BusinessMetricsCollector {
  constructor(options = {}) {
    this.metrics = options.metrics || null;
    this._initMetrics();
  }

  _initMetrics() {
    if (!this.metrics) return;
    try {
      const { Gauge, Counter } = require('prom-client');
      this.activeUsersGauge = new Gauge({
        name: 'active_users',
        help: 'Active users count (daily, weekly, monthly)',
        labelNames: ['period'],
        registers: [this.metrics]
      });
      this.featureAdoptionCounter = new Counter({
        name: 'feature_adoption_total',
        help: 'Total requests per feature',
        labelNames: ['feature_name'],
        registers: [this.metrics]
      });
      this.syncCountCounter = new Counter({
        name: 'syncs_completed_total',
        help: 'Total completions of student syncs by module',
        labelNames: ['module'],
        registers: [this.metrics]
      });
    } catch (err) {
      logger.warn(`[BusinessMetrics] Failed to initialize Prometheus metrics: ${err.message}`);
    }
  }

  async trackActiveUser(userId) {
    if (!redisService.isAlive()) return;
    const today = new Date().toISOString().split('T')[0];
    const client = redisService.client;
    try {
      await client.pfadd(`active:users:daily:${today}`, userId);
      const currentMonth = today.substring(0, 7);
      await client.pfadd(`active:users:monthly:${currentMonth}`, userId);
    } catch (err) {
      logger.warn(`[BusinessMetrics] Failed to track active user: ${err.message}`);
    }
  }

  async trackFeatureAccess(featureName) {
    if (this.featureAdoptionCounter) {
      this.featureAdoptionCounter.labels(featureName).inc();
    }
  }

  async trackSyncCompleted(moduleName) {
    if (this.syncCountCounter) {
      this.syncCountCounter.labels(moduleName).inc();
    }
  }

  async collectActiveUsers() {
    if (!redisService.isAlive()) return { daily: 0, monthly: 0 };
    const today = new Date().toISOString().split('T')[0];
    const currentMonth = today.substring(0, 7);
    const client = redisService.client;

    try {
      const daily = await client.pfcount(`active:users:daily:${today}`);
      const monthly = await client.pfcount(`active:users:monthly:${currentMonth}`);

      if (this.activeUsersGauge) {
        this.activeUsersGauge.labels('daily').set(daily);
        this.activeUsersGauge.labels('monthly').set(monthly);
      }

      return { daily, monthly };
    } catch (err) {
      logger.warn(`[BusinessMetrics] Failed to fetch active user counts: ${err.message}`);
      return { daily: 0, monthly: 0 };
    }
  }
}

module.exports = new BusinessMetricsCollector();
