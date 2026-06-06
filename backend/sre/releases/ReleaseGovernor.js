'use strict';

/**
 * ReleaseGovernor.js
 * SITAM Smart ERP — Release Governance Engine
 *
 * Checks release candidates against safety policies, requiring staging checks
 * and verifying there are no active freezes.
 */

const DeploymentGovernor = require('../deployment/DeploymentGovernor');
const logger = require('../../services/logger');

class ReleaseGovernor {
  constructor(options = {}) {
    this.deploymentGovernor = options.deploymentGovernor || new DeploymentGovernor(options);
    this.metrics = options.metrics || null;
    this._initMetrics();
  }

  _initMetrics() {
    if (!this.metrics) return;
    try {
      const { Gauge } = require('prom-client');
      this.releaseRiskIndex = new Gauge({
        name: 'release_governance_risk_index',
        help: 'Overall risk index for a proposed release (0-100)',
        registers: [this.metrics]
      });
    } catch (err) {
      logger.warn(`[ReleaseGovernor] Failed to initialize metrics: ${err.message}`);
    }
  }

  evaluateRelease(releaseMetadata = {}) {
    logger.info(`[ReleaseGovernor] Evaluating release candidate: ${releaseMetadata.version || 'unknown'}`);
    const safety = this.deploymentGovernor.checkDeploymentSafety();
    
    const scores = [];
    let approval = true;

    if (safety.recommendation === 'FREEZE') {
      approval = false;
      scores.push('SLO error budget exceeded or severe active incidents (BLOCKED)');
    }

    if (releaseMetadata.hasTestedInStaging === false) {
      approval = false;
      scores.push('Staging verification check missing (BLOCKED)');
    }

    const verdict = approval ? 'APPROVED' : 'REJECTED';
    
    if (this.releaseRiskIndex) {
      this.releaseRiskIndex.set(safety.riskScore);
    }

    logger.info(`[ReleaseGovernor] Release candidate verdict: ${verdict}. Risk score: ${safety.riskScore}`);
    return {
      verdict,
      riskScore: safety.riskScore,
      rejections: scores,
      timestamp: new Date().toISOString()
    };
  }
}

module.exports = ReleaseGovernor;
