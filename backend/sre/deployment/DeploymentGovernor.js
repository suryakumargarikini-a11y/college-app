'use strict';

/**
 * DeploymentGovernor.js
 * SITAM Smart ERP — Deployment Safety Gate
 *
 * Integrates error budgets and active SRE incident states to calculate
 * a deployment risk index. Produces release recommendations (SAFE, CAUTION, or FREEZE).
 */

const ErrorBudgetGovernor = require('../../observability/slo/ErrorBudgetGovernor');
const logger = require('../../services/logger');

class DeploymentGovernor {
  constructor(options = {}) {
    this.errorBudgetGovernor = options.errorBudgetGovernor || new ErrorBudgetGovernor(options);
    this.incidentManager = options.incidentManager || null;
  }

  checkDeploymentSafety() {
    logger.info('[DeploymentGovernor] Assessing release risks...');
    const budgetAssessment = this.errorBudgetGovernor.assessDeploymentSafety();
    
    let recommendation = budgetAssessment.recommendation;
    let riskScore = budgetAssessment.riskScore;
    const warnings = [...budgetAssessment.warnings];

    if (this.incidentManager) {
      const activeIncidents = this.incidentManager.listActive();
      const activeCount = activeIncidents.length;
      if (activeCount > 0) {
        riskScore += activeCount * 15;
        warnings.push(`${activeCount} active incident(s) unresolved.`);
        
        const hasCritical = activeIncidents.some(i => i.severity === 'SEV1' || i.severity === 'SEV2');
        if (hasCritical) {
          riskScore += 30;
          warnings.push('Active high-severity (SEV1/SEV2) incidents exist.');
        }
      }
    }

    if (riskScore >= 50) {
      recommendation = 'FREEZE';
    } else if (riskScore >= 20) {
      recommendation = 'CAUTION';
    } else {
      recommendation = 'SAFE';
    }

    logger.info(`[DeploymentGovernor] Risk assessment finished. Score: ${riskScore}, Verdict: ${recommendation}`);
    return {
      recommendation,
      riskScore,
      warnings,
      timestamp: new Date().toISOString()
    };
  }
}

module.exports = DeploymentGovernor;
