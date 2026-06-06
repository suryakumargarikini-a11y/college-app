'use strict';

/**
 * ErrorBudgetGovernor.js
 * SITAM Smart ERP — Error Budget Deployment Governance
 *
 * Implements deployment risk checks based on active SLO burn rates and remaining
 * error budgets. Recommends SAFE, CAUTION, or FREEZE states and exposes metrics
 * to block pipelines when risk scores are elevated.
 */

const SLOFramework = require('./SLOFramework');
const logger = require('../../services/logger');

class ErrorBudgetGovernor {
  constructor(options = {}) {
    this.sloFramework = options.sloFramework || new SLOFramework(options);
    this.metrics = options.metrics || null;
    this._initMetrics();
  }

  _initMetrics() {
    if (!this.metrics) return;
    try {
      const { Gauge } = require('prom-client');
      this.deploymentSafetyGauge = new Gauge({
        name: 'deployment_safety_status',
        help: 'Safety gate for deployments (2 = SAFE, 1 = CAUTION, 0 = FREEZE)',
        registers: [this.metrics]
      });
      this.reliabilityRiskScoreGauge = new Gauge({
        name: 'reliability_risk_score',
        help: 'Composite reliability risk score (0-100, lower = safer)',
        registers: [this.metrics]
      });
    } catch (err) {
      logger.warn(`[ErrorBudgetGovernor] Failed to initialize metrics: ${err.message}`);
    }
  }

  assessDeploymentSafety() {
    logger.info('[ErrorBudgetGovernor] Assessing deployment safety gate against error budgets...');
    const assessments = this.sloFramework.calculateBudgets();
    
    let recommendation = 'SAFE';
    let riskScore = 0;
    const warnings = [];

    for (const slo of assessments) {
      const totalBudget = this.sloFramework.getSLO(slo.name).monthlyBudgetMin;
      const remainingRatio = slo.budgetRemainingMin / (totalBudget || 1);
      const burn1h = slo.burnRates['1h'];
      const burn6h = slo.burnRates['6h'];

      if (burn1h >= 14.0) {
        riskScore += 40;
        warnings.push(`Fast burn rate detected on ${slo.name}: 1h burn is ${burn1h}x (Threshold: 14x)`);
      } else if (burn6h >= 5.0) {
        riskScore += 20;
        warnings.push(`Slow burn rate detected on ${slo.name}: 6h burn is ${burn6h}x (Threshold: 5x)`);
      }

      if (remainingRatio <= 0.0) {
        riskScore += 50;
        warnings.push(`Error budget exhausted for ${slo.name} (0% remaining)`);
      } else if (remainingRatio < 0.20) {
        riskScore += 25;
        warnings.push(`Error budget low for ${slo.name} (${Math.round(remainingRatio * 100)}% remaining)`);
      }
    }

    let gateStatus = 2;
    if (riskScore >= 50) {
      recommendation = 'FREEZE';
      gateStatus = 0;
      logger.error(`[ErrorBudgetGovernor] DEPLOYMENT GATES BLOCKED: Recommendation is ${recommendation}. Warnings: ${warnings.join('; ')}`);
    } else if (riskScore >= 20) {
      recommendation = 'CAUTION';
      gateStatus = 1;
      logger.warn(`[ErrorBudgetGovernor] DEPLOYMENT GATES WARNING: Recommendation is ${recommendation}. Warnings: ${warnings.join('; ')}`);
    } else {
      logger.info(`[ErrorBudgetGovernor] DEPLOYMENT GATES CLEAR: Recommendation is ${recommendation}.`);
    }

    if (this.deploymentSafetyGauge) {
      this.deploymentSafetyGauge.set(gateStatus);
    }
    if (this.reliabilityRiskScoreGauge) {
      this.reliabilityRiskScoreGauge.set(riskScore);
    }

    return {
      recommendation,
      riskScore,
      gateStatus,
      warnings,
      checkedAt: new Date().toISOString()
    };
  }
}

module.exports = ErrorBudgetGovernor;
