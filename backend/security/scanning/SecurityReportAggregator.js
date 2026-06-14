'use strict';

/**
 * SecurityReportAggregator.js
 * SITAM Smart ERP — DevSecOps Reporting Aggregator
 *
 * Consolidates security findings from dependency analysis, vulnerability scanners,
 * and DAST (Dynamic Application Security Testing) fuzzing runs.
 * Computes a weighted risk score (0-100, lower is safer), maintains a sorted
 * remediation priority queue, tracks historical security posture trends, and exports
 * Prometheus-compatible metrics.
 *
 * Phase 2: DAST report ingestion — reads dast-report-*.json from the same
 * date-scoped report directory and folds CRITICAL/HIGH DAST findings into the
 * composite risk score. Adds getLatestReport() for DeploymentGovernor consumption.
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
      this.dastFindingsTotal = new Gauge({
        name: 'dast_findings_total',
        help: 'Total DAST vulnerability findings ingested into last aggregate report',
        labelNames: ['severity'],
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
      return { score: 0, remediations: [], trends: [], dastFindingsCount: 0 };
    }

    // ── Dependency scan reports ───────────────────────────────────────────────
    const summaryPath = path.join(reportDir, 'severity-summary.json');
    const riskPath    = path.join(reportDir, 'dependency-risk-report.json');

    let summary    = { vulnerabilities: { critical: 0, high: 0, medium: 0, low: 0, info: 0 } };
    let riskReport = { risks: [] };

    if (fs.existsSync(summaryPath)) {
      summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
    }
    if (fs.existsSync(riskPath)) {
      riskReport = JSON.parse(fs.readFileSync(riskPath, 'utf8'));
    }

    const { critical = 0, high = 0, medium = 0, low = 0 } = summary.vulnerabilities || {};
    let rawScore = (critical * 10) + (high * 5) + (medium * 2) + (low * 0.5);

    // ── DAST reports (Phase 2) ────────────────────────────────────────────────
    // Read any dast-report-*.json files written by APIFuzzer/SecurityTestRunner.
    const dastCounts = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
    let totalDastFindings = 0;
    const dastRemediations = [];

    try {
      const files = fs.readdirSync(reportDir).filter(f => f.startsWith('dast-report-') && f.endsWith('.json'));
      for (const file of files) {
        const dastReport = JSON.parse(fs.readFileSync(path.join(reportDir, file), 'utf8'));
        totalDastFindings += dastReport.findingsCount || 0;

        for (const finding of (dastReport.findings || [])) {
          const sev = (finding.severity || 'LOW').toUpperCase();
          dastCounts[sev] = (dastCounts[sev] || 0) + 1;

          // Fold DAST findings into risk score
          if (sev === 'CRITICAL') rawScore += 15;
          else if (sev === 'HIGH')     rawScore += 7;
          else if (sev === 'MEDIUM')   rawScore += 3;
          else                         rawScore += 0.5;

          dastRemediations.push({
            target: finding.endpoint,
            severity: finding.severity,
            action: `[DAST] ${finding.vulnerability} — ${finding.guidance}`,
            priority: (sev === 'CRITICAL' || sev === 'HIGH') ? 1 : (sev === 'MEDIUM' ? 2 : 3)
          });
        }
      }
    } catch (err) {
      logger.warn(`[SecurityReportAggregator] DAST report ingestion error: ${err.message}`);
    }

    // ── Emit DAST Prometheus metrics ─────────────────────────────────────────
    if (this.dastFindingsTotal) {
      for (const [severity, count] of Object.entries(dastCounts)) {
        this.dastFindingsTotal.set({ severity }, count);
      }
    }

    const score = Math.min(100, rawScore);

    // ── Dependency remediations ───────────────────────────────────────────────
    const depRemediations = [];
    for (const r of riskReport.risks || []) {
      depRemediations.push({
        target: r.packageName,
        severity: r.severity,
        action: `Review package ${r.packageName}@${r.version} findings: ${r.findings.join('; ')}`,
        priority: r.severity === 'HIGH' || r.severity === 'CRITICAL' ? 1 : (r.severity === 'MEDIUM' ? 2 : 3)
      });
    }

    const remediations = [...dastRemediations, ...depRemediations];
    remediations.sort((a, b) => a.priority - b.priority);

    const trends = this._trackTrends();

    const aggregatedReport = {
      aggregatedAt: new Date().toISOString(),
      date: targetDate,
      score,
      dastFindingsCount: totalDastFindings,
      dastSeverityCounts: dastCounts,
      remediations,
      trends
    };

    fs.writeFileSync(
      path.join(reportDir, 'aggregated-security-report.json'),
      JSON.stringify(aggregatedReport, null, 2),
      'utf8'
    );

    if (this.compositeSecurityScore)    this.compositeSecurityScore.set(score);
    if (this.remediationPendingCount)   this.remediationPendingCount.set(remediations.length);

    logger.info(
      `[SecurityReportAggregator] Aggregation complete. Composite Score: ${score} ` +
      `(dep remediations: ${depRemediations.length}, DAST findings: ${totalDastFindings})`
    );
    return aggregatedReport;
  }

  /**
   * Returns the most recent aggregated security report from disk.
   * Used by DeploymentGovernor to gate deployments on security posture.
   *
   * @returns {{ score: number, dastFindingsCount: number, remediations: Array } | null}
   */
  getLatestReport() {
    if (!fs.existsSync(this.reportsDir)) return null;
    const dirs = fs.readdirSync(this.reportsDir)
      .filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d))
      .sort()
      .reverse();

    for (const d of dirs) {
      const aggPath = path.join(this.reportsDir, d, 'aggregated-security-report.json');
      if (fs.existsSync(aggPath)) {
        try {
          return JSON.parse(fs.readFileSync(aggPath, 'utf8'));
        } catch (e) {
          logger.warn(`[SecurityReportAggregator] Failed to read latest report: ${e.message}`);
        }
      }
    }
    return null;
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
