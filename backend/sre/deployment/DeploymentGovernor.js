'use strict';

/**
 * DeploymentGovernor.js
 * SITAM Smart ERP — Deployment Safety Gate
 *
 * Integrates error budgets, active SRE incident states, and the live security
 * posture score from SecurityReportAggregator to calculate a deployment risk index.
 * Produces release recommendations (SAFE, CAUTION, or FREEZE).
 *
 * Phase 2: Accepts optional securityReportAggregator. When present, the latest
 * aggregated security score is included in the risk calculation, and a
 * deployment_security_risk_penalty Prometheus gauge is emitted.
 */

const ErrorBudgetGovernor = require('../../observability/slo/ErrorBudgetGovernor');
const logger = require('../../services/logger');

class DeploymentGovernor {
  constructor(options = {}) {
    this.errorBudgetGovernor = options.errorBudgetGovernor || new ErrorBudgetGovernor(options);
    this.incidentManager = options.incidentManager || null;

    // Phase 2: SecurityReportAggregator for security posture gating
    this.securityReportAggregator = options.securityReportAggregator || null;

    this.metrics = options.metrics || null;
    this._initMetrics();
  }

  _initMetrics() {
    if (!this.metrics) return;
    try {
      const { Gauge } = require('prom-client');
      this.deploymentSecurityRiskPenalty = new Gauge({
        name: 'deployment_security_risk_penalty',
        help: 'Security risk penalty applied to the deployment risk index from live security posture score',
        registers: [this.metrics]
      });
    } catch (err) {
      logger.warn(`[DeploymentGovernor] Failed to initialize metrics: ${err.message}`);
    }
  }

  checkDeploymentSafety() {
    logger.info('[DeploymentGovernor] Assessing release risks...');
    const budgetAssessment = this.errorBudgetGovernor.assessDeploymentSafety();

    let recommendation = budgetAssessment.recommendation;
    let riskScore = budgetAssessment.riskScore;
    const warnings = [...budgetAssessment.warnings];

    // ── Active Incidents ──────────────────────────────────────────────────────
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

    // ── Security Posture Gate (Phase 2) ───────────────────────────────────────
    // Reads the most recent aggregated security report written by
    // SecurityReportAggregator.aggregate(). Score 0-100 (lower = safer).
    let securityPenalty = 0;
    if (this.securityReportAggregator) {
      try {
        const latestSecReport = this.securityReportAggregator.getLatestReport();
        if (latestSecReport) {
          const secScore = latestSecReport.score || 0;
          const dastFindings = latestSecReport.dastFindingsCount || 0;

          // Penalty tiers based on composite security score
          if (secScore >= 50) {
            securityPenalty += 30;
            warnings.push(`Security posture CRITICAL: composite score ${secScore}/100 (≥50 triggers freeze risk).`);
          } else if (secScore >= 25) {
            securityPenalty += 15;
            warnings.push(`Security posture WARNING: composite score ${secScore}/100.`);
          } else if (secScore > 0) {
            securityPenalty += 5;
          }

          // Additional DAST finding penalty
          if (dastFindings > 0) {
            const dastPenalty = Math.min(20, dastFindings * 3);
            securityPenalty += dastPenalty;
            warnings.push(`${dastFindings} active DAST findings contribute ${dastPenalty} risk points.`);
          }

          riskScore += securityPenalty;
          logger.info(
            `[DeploymentGovernor] Security posture check: score=${secScore}, ` +
            `dastFindings=${dastFindings}, penalty=${securityPenalty}`
          );
        }
      } catch (err) {
        logger.warn(`[DeploymentGovernor] Security posture check failed: ${err.message}`);
      }
    }

    // ── Emit security penalty gauge ───────────────────────────────────────────
    if (this.deploymentSecurityRiskPenalty) {
      this.deploymentSecurityRiskPenalty.set(securityPenalty);
    }

    // ── Final Recommendation ──────────────────────────────────────────────────
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
      securityPenalty,
      warnings,
      timestamp: new Date().toISOString()
    };
  }
}

module.exports = DeploymentGovernor;
