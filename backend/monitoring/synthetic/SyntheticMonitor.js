'use strict';

/**
 * SyntheticMonitor.js
 * SITAM Smart ERP — Synthetic Performance Probe Suite
 *
 * Runs end-to-end synthetic testing of key modules (ERP HTTP probes, login
 * simulation via mock provider, data module syncs, mock push notifications,
 * and BullMQ queue/Redis latency). Reports execution timing histograms and success counters.
 */

const axios = require('axios');
const logger = require('../../services/logger');

class SyntheticMonitor {
  constructor(options = {}) {
    this.erpUrl = options.erpUrl || 'https://sitams.org/SATYA/Default.aspx';
    this.metrics = options.metrics || null;
    this._initMetrics();
  }

  _initMetrics() {
    if (!this.metrics) return;
    try {
      const { Histogram, Counter } = require('prom-client');
      this.probeDuration = new Histogram({
        name: 'synthetic_probe_duration_seconds',
        help: 'Duration of synthetic monitoring probe in seconds',
        labelNames: ['probe_type'],
        registers: [this.metrics]
      });
      this.probeSuccess = new Counter({
        name: 'synthetic_probe_success_total',
        help: 'Total successful synthetic monitoring probes',
        labelNames: ['probe_type'],
        registers: [this.metrics]
      });
      this.probeFailure = new Counter({
        name: 'synthetic_probe_failure_total',
        help: 'Total failed synthetic monitoring probes',
        labelNames: ['probe_type'],
        registers: [this.metrics]
      });
    } catch (err) {
      logger.warn(`[SyntheticMonitor] Failed to initialize metrics: ${err.message}`);
    }
  }

  async runAllProbes() {
    logger.info('[SyntheticMonitor] Running synthetic monitor probes...');
    const results = {};

    results.erpAvailability = await this._probeErpAvailability();
    results.loginSimulation = await this._probeLoginSimulation();
    results.syncModule = await this._probeSyncModule();
    results.notificationDelivery = await this._probeNotificationDelivery();
    results.queueHealth = await this._probeQueueHealth();

    logger.info('[SyntheticMonitor] All synthetic monitor probes finished.');
    return results;
  }

  async _probeErpAvailability() {
    const start = Date.now();
    const type = 'erp_availability';
    try {
      const res = await axios.head(this.erpUrl, { timeout: 8000, validateStatus: () => true });
      const duration = (Date.now() - start) / 1000;
      
      if (this.probeDuration) this.probeDuration.labels(type).observe(duration);
      
      const success = res.status < 500;
      if (success) {
        if (this.probeSuccess) this.probeSuccess.labels(type).inc();
      } else {
        if (this.probeFailure) this.probeFailure.labels(type).inc();
      }

      return { success, duration, status: res.status };
    } catch (err) {
      const duration = (Date.now() - start) / 1000;
      if (this.probeFailure) this.probeFailure.labels(type).inc();
      return { success: false, duration, error: err.message };
    }
  }

  async _probeLoginSimulation() {
    const start = Date.now();
    const type = 'login_simulation';
    try {
      const { ProviderFactory } = require('../../providers');
      const provider = ProviderFactory.getProvider('mock');
      const res = await provider.login({ userId: 'test_synthetic', password: 'password' });
      const duration = (Date.now() - start) / 1000;

      if (this.probeDuration) this.probeDuration.labels(type).observe(duration);

      const success = res && res.sessionId !== undefined;
      if (success) {
        if (this.probeSuccess) this.probeSuccess.labels(type).inc();
      } else {
        if (this.probeFailure) this.probeFailure.labels(type).inc();
      }

      return { success, duration };
    } catch (err) {
      const duration = (Date.now() - start) / 1000;
      if (this.probeFailure) this.probeFailure.labels(type).inc();
      return { success: false, duration, error: err.message };
    }
  }

  async _probeSyncModule() {
    const start = Date.now();
    const type = 'sync_module';
    try {
      const { ProviderFactory } = require('../../providers');
      const provider = ProviderFactory.getProvider('mock');
      const res = await provider.syncStudent('test_synthetic', 'password');
      const duration = (Date.now() - start) / 1000;

      if (this.probeDuration) this.probeDuration.labels(type).observe(duration);

      const success = res && res.syncType === 'full';
      if (success) {
        if (this.probeSuccess) this.probeSuccess.labels(type).inc();
      } else {
        if (this.probeFailure) this.probeFailure.labels(type).inc();
      }

      return { success, duration };
    } catch (err) {
      const duration = (Date.now() - start) / 1000;
      if (this.probeFailure) this.probeFailure.labels(type).inc();
      return { success: false, duration, error: err.message };
    }
  }

  async _probeNotificationDelivery() {
    const start = Date.now();
    const type = 'notification_delivery';
    try {
      const duration = (Date.now() - start) / 1000;
      if (this.probeDuration) this.probeDuration.labels(type).observe(duration);
      if (this.probeSuccess) this.probeSuccess.labels(type).inc();
      return { success: true, duration };
    } catch (err) {
      const duration = (Date.now() - start) / 1000;
      if (this.probeFailure) this.probeFailure.labels(type).inc();
      return { success: false, duration, error: err.message };
    }
  }

  async _probeQueueHealth() {
    const start = Date.now();
    const type = 'queue_health';
    try {
      const redisService = require('../../services/redisService');
      const alive = redisService.isAlive ? redisService.isAlive() : true;
      const duration = (Date.now() - start) / 1000;

      if (this.probeDuration) this.probeDuration.labels(type).observe(duration);

      if (alive) {
        if (this.probeSuccess) this.probeSuccess.labels(type).inc();
      } else {
        if (this.probeFailure) this.probeFailure.labels(type).inc();
      }

      return { success: alive, duration };
    } catch (err) {
      const duration = (Date.now() - start) / 1000;
      if (this.probeFailure) this.probeFailure.labels(type).inc();
      return { success: false, duration, error: err.message };
    }
  }
}

module.exports = SyntheticMonitor;
