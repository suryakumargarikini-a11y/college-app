'use strict';

/**
 * KeyRotationScheduler.js
 * SITAM Smart ERP — DevSecOps Secret Rotation Scheduler
 *
 * Runs scheduled audits on active credentials, emitting warning counters and
 * generating specific remediation/rotation action logs when credentials enter
 * their defined rotation windows.
 */

const SecretGovernanceManager = require('./SecretGovernanceManager');
const logger = require('../../services/logger');

class KeyRotationScheduler {
  constructor(options = {}) {
    this.governanceManager = options.governanceManager || new SecretGovernanceManager(options);
    this.metrics = options.metrics || null;
    this._initMetrics();
  }

  _initMetrics() {
    if (!this.metrics) return;
    try {
      const { Counter } = require('prom-client');
      this.rotationRequiredCounter = new Counter({
        name: 'secret_rotation_required_total',
        help: 'Total number of secret rotations required warnings emitted',
        labelNames: ['secret_name'],
        registers: [this.metrics]
      });
    } catch (err) {
      logger.warn(`[KeyRotationScheduler] Failed to initialize metrics: ${err.message}`);
    }
  }

  checkRotationSchedules() {
    logger.info('[KeyRotationScheduler] Running rotation schedule checks...');
    const assessments = this.governanceManager.assessSecrets();
    const actionItems = [];

    for (const item of assessments) {
      if (item.rotationRequired) {
        logger.warn(`[KeyRotationScheduler] ROTATION REQUIRED: Credential "${item.name}" has health ${item.healthScore}% and ${item.daysRemaining} days remaining.`);
        
        if (this.rotationRequiredCounter) {
          this.rotationRequiredCounter.labels(item.name).inc();
        }

        actionItems.push({
          name: item.name,
          type: item.type,
          healthScore: item.healthScore,
          daysRemaining: item.daysRemaining,
          recommendedAction: `Rotate credential ${item.name} immediately via SecretGovernanceManager.rotateSecret('${item.name}')`
        });
      }
    }

    logger.info(`[KeyRotationScheduler] Schedule check complete. ${actionItems.length} rotation action items generated.`);
    return actionItems;
  }
}

module.exports = KeyRotationScheduler;
