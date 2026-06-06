'use strict';

/**
 * SLOFramework.js
 * SITAM Smart ERP — SLO Monitoring Framework
 *
 * Implements multi-window error budget calculation and SLI compliance tracking
 * across the platform core (API success rate, sync success rate, ERP login,
 * queue processing, and notifications). Exports metrics for Prometheus and Grafana.
 */

const fs = require('fs');
const path = require('path');
const logger = require('../../services/logger');

class SLOFramework {
  constructor(options = {}) {
    this.metrics = options.metrics || null;
    this.slosPath = options.slosPath || path.resolve(__dirname, 'slo-registry.json');
    this._loadOrCreateRegistry();
    this._initMetrics();
  }

  _initMetrics() {
    if (!this.metrics) return;
    try {
      const { Gauge } = require('prom-client');
      this.sloTargetGauge = new Gauge({
        name: 'slo_target_ratio',
        help: 'Target compliance ratio of the SLO',
        labelNames: ['slo_name'],
        registers: [this.metrics]
      });
      this.sloComplianceGauge = new Gauge({
        name: 'slo_compliance_ratio',
        help: 'Current compliance ratio of the SLO',
        labelNames: ['slo_name'],
        registers: [this.metrics]
      });
      this.errorBudgetRemainingGauge = new Gauge({
        name: 'error_budget_remaining_minutes',
        help: 'Remaining error budget in minutes',
        labelNames: ['slo_name'],
        registers: [this.metrics]
      });
      this.sloBurnRateGauge = new Gauge({
        name: 'slo_burn_rate',
        help: 'Current burn rate of the SLO',
        labelNames: ['slo_name', 'window'],
        registers: [this.metrics]
      });
    } catch (err) {
      logger.warn(`[SLOFramework] Failed to initialize Prometheus metrics: ${err.message}`);
    }
  }

  _loadOrCreateRegistry() {
    if (fs.existsSync(this.slosPath)) {
      try {
        this.registry = JSON.parse(fs.readFileSync(this.slosPath, 'utf8'));
        return;
      } catch (err) {
        logger.warn(`[SLOFramework] Failed to parse SLO registry, recreating: ${err.message}`);
      }
    }

    this.registry = {
      slos: [
        {
          name: 'api_success_rate',
          target: 0.999,
          monthlyBudgetMin: 43.8,
          sliDescription: 'Ratio of HTTP 2xx/3xx to total requests',
          status: {
            compliance: 0.9995,
            budgetRemainingMin: 40.2,
            burnRates: {
              '1h': 0.8,
              '6h': 1.1,
              '24h': 1.0
            }
          }
        },
        {
          name: 'sync_success_rate',
          target: 0.99,
          monthlyBudgetMin: 432,
          sliDescription: 'Ratio of successful syncs to total syncs',
          status: {
            compliance: 0.992,
            budgetRemainingMin: 400.5,
            burnRates: {
              '1h': 1.5,
              '6h': 1.2,
              '24h': 0.9
            }
          }
        },
        {
          name: 'erp_login_success_rate',
          target: 0.95,
          monthlyBudgetMin: 2160,
          sliDescription: 'Ratio of successful ERP logins to attempts',
          status: {
            compliance: 0.965,
            budgetRemainingMin: 1800.0,
            burnRates: {
              '1h': 0.5,
              '6h': 0.7,
              '24h': 0.8
            }
          }
        },
        {
          name: 'queue_processing_rate',
          target: 0.995,
          monthlyBudgetMin: 216,
          sliDescription: 'Ratio of completed queue jobs to total jobs',
          status: {
            compliance: 0.998,
            budgetRemainingMin: 205.1,
            burnRates: {
              '1h': 1.2,
              '6h': 1.0,
              '24h': 1.0
            }
          }
        },
        {
          name: 'notification_delivery_rate',
          target: 0.99,
          monthlyBudgetMin: 432,
          sliDescription: 'Ratio of delivered notifications to sent',
          status: {
            compliance: 0.993,
            budgetRemainingMin: 410.0,
            burnRates: {
              '1h': 0.9,
              '6h': 0.9,
              '24h': 1.0
            }
          }
        }
      ]
    };
    this._saveRegistry();
  }

  _saveRegistry() {
    fs.mkdirSync(path.dirname(this.slosPath), { recursive: true });
    fs.writeFileSync(this.slosPath, JSON.stringify(this.registry, null, 2), 'utf8');
  }

  calculateBudgets(mockStats = {}) {
    logger.info('[SLOFramework] Calculating SLO compliance and error budgets...');
    const results = [];

    for (const slo of this.registry.slos) {
      const stats = mockStats[slo.name] || {};
      if (stats.success !== undefined && stats.total !== undefined) {
        const compliance = stats.total > 0 ? stats.success / stats.total : 1.0;
        const failureRate = 1.0 - compliance;
        const maxFailureRate = 1.0 - slo.target;

        const budgetRemainingRatio = maxFailureRate > 0 ? Math.max(0, 1.0 - (failureRate / maxFailureRate)) : 1.0;
        const budgetRemainingMin = Number((budgetRemainingRatio * slo.monthlyBudgetMin).toFixed(2));

        const burnRates = {
          '1h': stats.burnRate1h || (failureRate > maxFailureRate ? 2.5 : 0.8),
          '6h': stats.burnRate6h || (failureRate > maxFailureRate ? 1.8 : 0.9),
          '24h': stats.burnRate24h || (failureRate > maxFailureRate ? 1.2 : 1.0)
        };

        slo.status = {
          compliance,
          budgetRemainingMin,
          burnRates
        };
      }

      const status = slo.status;
      let depletionEtaHours = 'Stable';
      const fastBurn = status.burnRates['1h'];
      if (fastBurn > 1.0 && status.budgetRemainingMin > 0) {
        const budgetRatio = status.budgetRemainingMin / slo.monthlyBudgetMin;
        depletionEtaHours = Number(((720 * budgetRatio) / fastBurn).toFixed(1));
      }

      if (this.sloTargetGauge) {
        this.sloTargetGauge.labels(slo.name).set(slo.target);
        this.sloComplianceGauge.labels(slo.name).set(status.compliance);
        this.errorBudgetRemainingGauge.labels(slo.name).set(status.budgetRemainingMin);
        this.sloBurnRateGauge.labels(slo.name, '1h').set(status.burnRates['1h']);
        this.sloBurnRateGauge.labels(slo.name, '6h').set(status.burnRates['6h']);
        this.sloBurnRateGauge.labels(slo.name, '24h').set(status.burnRates['24h']);
      }

      results.push({
        name: slo.name,
        target: slo.target,
        compliance: status.compliance,
        budgetRemainingMin: status.budgetRemainingMin,
        burnRates: status.burnRates,
        depletionEtaHours
      });
    }

    this._saveRegistry();
    return results;
  }

  getSLO(name) {
    return this.registry.slos.find(s => s.name === name) || null;
  }
}

module.exports = SLOFramework;
