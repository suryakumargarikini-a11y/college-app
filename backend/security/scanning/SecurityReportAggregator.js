'use strict';

/**
 * SecurityReportAggregator.js
 * SITAM Smart ERP — DevSecOps Reporting Aggregator
 *
 * Consolidates security findings from dependency analysis and vulnerability scanners.
 * Computes a weighted risk score (0-100, lower is safer), maintains a sorted
 * remediation priority queue, tracks historical security posture trends, and exports
 * Prometheus-compatible metrics.
 */

const fs = require('fs');
const path = require('path');
const logger = require('../../services/logger');

class SecurityReportAggregator {
  constructor(options = {}) {
    this.reportsDir = options.reportsDir || path.resolve(__dirname, '../../security-reports');
    this.metrics = options.metrics || null;
    this._initMetrics();
  }

  _initMetrics() {
    if (!this.metrics) return;
    try {
      const { Gauge } = require('prom-client');
      this.compositeSecurityScore = new Gauge({
        name: 'composite_security_score',
        help: 'Composite security risk score (0-100, lower = safer)',
        registers: [this.metrics]
      });
      this.remediationPendingCount = new Gauge({
        name: 'remediation_pending_count',
        help: 'Number of pending security remediations',
        registers: [this.metrics]
      });
    } catch (err) {
      logger.warn(`[SecurityReportAggregator] Failed to initialize metrics: ${err.message}`);
    }
  }

  aggregate(dateStr) {
    const targetDate = dateStr || new Date().toISOString().split('T')[0];
    const reportDir = path.join(this.reportsDir, targetDate);

    logger.info(`[SecurityReportAggregator] Aggregating reports for date: ${targetDate}`);
    if (!fs.existsSync(reportDir)) {
      return { score: 0, remediations: [], trends: [] };
    }

    const summaryPath = path.join(reportDir, 'severity-summary.json');
    const riskPath = path.join(reportDir, 'dependency-risk-report.json');

    let summary = { vulnerabilities: { critical: 0, high: 0, medium: 0, low: 0, info: 0 } };
    let riskReport = { risks: [] };

    if (fs.existsSync(summaryPath)) {
      summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
    }
    if (fs.existsSync(riskPath)) {
      riskReport = JSON.parse(fs.readFileSync(riskPath, 'utf8'));
    }

    const { critical = 0, high = 0, medium = 0, low = 0 } = summary.vulnerabilities || {};
    const rawScore = (critical * 10) + (high * 5) + (medium * 2) + (low * 0.5);
    const score = Math.min(100, rawScore);

    const remediations = [];
    for (const r of riskReport.risks || []) {
      remediations.push({
        target: r.packageName,
        severity: r.severity,
        action: `Review package ${r.packageName}@${r.version} findings: ${r.findings.join('; ')}`,
        priority: r.severity === 'HIGH' || r.severity === 'CRITICAL' ? 1 : (r.severity === 'MEDIUM' ? 2 : 3)
      });
    }

    remediations.sort((a, b) => a.priority - b.priority);
    const trends = this._trackTrends();

    const aggregatedReport = {
      aggregatedAt: new Date().toISOString(),
      date: targetDate,
      score,
      remediations,
      trends
    };

    fs.writeFileSync(path.join(reportDir, 'aggregated-security-report.json'), JSON.stringify(aggregatedReport, null, 2), 'utf8');

    if (this.compositeSecurityScore) {
      this.compositeSecurityScore.set(score);
    }
    if (this.remediationPendingCount) {
      this.remediationPendingCount.set(remediations.length);
    }

    logger.info(`[SecurityReportAggregator] Aggregation complete. Composite Score: ${score} (pending: ${remediations.length})`);
    return aggregatedReport;
  }

  _trackTrends() {
    if (!fs.existsSync(this.reportsDir)) return [];
    const dirs = fs.readdirSync(this.reportsDir).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d));
    dirs.sort();

    const trends = [];
    for (const d of dirs) {
      const aggPath = path.join(this.reportsDir, d, 'aggregated-security-report.json');
      if (fs.existsSync(aggPath)) {
        try {
          const report = JSON.parse(fs.readFileSync(aggPath, 'utf8'));
          trends.push({
            date: d,
            score: report.score,
            pendingRemediations: report.remediations.length
          });
        } catch (e) { /* skip */ }
      }
    }
    return trends;
  }
}

module.exports = SecurityReportAggregator;
