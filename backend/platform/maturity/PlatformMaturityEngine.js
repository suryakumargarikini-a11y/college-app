'use strict';

/**
 * PlatformMaturityEngine.js
 * SITAM Smart ERP — Platform Maturity Engine
 *
 * Consolidates security compliance assessments and SRE operational reliability scorecards
 * to compute a unified platform maturity index.
 */

const logger = require('../../services/logger');
const ComplianceFrameworkEngine = require('../../security/compliance/ComplianceFrameworkEngine').ComplianceFrameworkEngine;
const ReliabilityScorecardEngine = require('../../sre/scorecards/ReliabilityScorecardEngine');

class PlatformMaturityEngine {
  constructor(options = {}) {
    this.complianceEngine = options.complianceEngine || new ComplianceFrameworkEngine(options);
    this.scorecardEngine = options.scorecardEngine || new ReliabilityScorecardEngine(options);
    this.metrics = options.metrics || null;
    this._initMetrics();
  }

  _initMetrics() {
    if (!this.metrics) return;
    try {
      const { Gauge } = require('prom-client');
      this.maturityScoreGauge = new Gauge({
        name: 'platform_maturity_score',
        help: 'Overall platform maturity index (0-100)',
        registers: [this.metrics]
      });
    } catch (err) {
      logger.warn(`[PlatformMaturityEngine] Failed to initialize metrics: ${err.message}`);
    }
  }

  async evaluateMaturity() {
    logger.info('[PlatformMaturityEngine] Evaluating overall platform maturity index...');
    
    const complianceSummary = await this.complianceEngine.assessAll();
    const scorecards = await this.scorecardEngine.computeScorecards();

    const complianceScore = complianceSummary.overallScore;
    const reliabilityScore = scorecards.platform.score;

    const maturityScore = Math.round((complianceScore * 0.5) + (reliabilityScore * 0.5));

    if (this.maturityScoreGauge) {
      this.maturityScoreGauge.set(maturityScore);
    }

    logger.info(`[PlatformMaturityEngine] Maturity assessment complete. Overall Index: ${maturityScore}%`);
    return {
      maturityScore,
      complianceScore,
      reliabilityScore,
      timestamp: new Date().toISOString()
    };
  }
}

module.exports = PlatformMaturityEngine;
