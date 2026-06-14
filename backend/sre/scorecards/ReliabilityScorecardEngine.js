'use strict';

/**
 * ReliabilityScorecardEngine.js
 * SITAM Smart ERP — SRE Reliability Scorecard Engine
 *
 * Evaluates performance indicators across multiple operational dimensions (ERP scraper performance,
 * browser pool stability, BullMQ queues, worker tasks, and synchronization completeness).
 * Assigns letter grades and publishes gauges.
 */

const logger = require('../../services/logger');

class ReliabilityScorecardEngine {
  constructor(options = {}) {
    this.metrics = options.metrics || null;
    this._initMetrics();
  }

  _initMetrics() {
    if (!this.metrics) return;
    try {
      const { Gauge } = require('prom-client');
      this.scorecardGauge = new Gauge({
        name: 'reliability_scorecard_value',
        help: 'Value of the reliability scorecard (0-100)',
        labelNames: ['scorecard_type'],
        registers: [this.metrics]
      });
    } catch (err) {
      logger.warn(`[ScorecardEngine] Failed to initialize metrics: ${err.message}`);
    }
  }

  async computeScorecards(telemetryStats = null) {
    logger.info('[ScorecardEngine] Computing reliability scorecards...');
    
    let erpScore = 100;
    let browserScore = 100;
    let queueScore = 100;
    let workerScore = 100;
    let syncScore = 100;

    if (telemetryStats && typeof telemetryStats === 'object' && Object.keys(telemetryStats).length > 0) {
      erpScore = telemetryStats.erpScore !== undefined ? telemetryStats.erpScore : erpScore;
      browserScore = telemetryStats.browserScore !== undefined ? telemetryStats.browserScore : browserScore;
      queueScore = telemetryStats.queueScore !== undefined ? telemetryStats.queueScore : queueScore;
      workerScore = telemetryStats.workerScore !== undefined ? telemetryStats.workerScore : workerScore;
      syncScore = telemetryStats.syncScore !== undefined ? telemetryStats.syncScore : syncScore;
    } else if (this.metrics) {
      try {
        const rawMetrics = await this.metrics.getMetricsAsJSON();
        const metricMap = {};
        for (const m of rawMetrics) {
          metricMap[m.name] = m;
        }

        const getVal = (m) => (!m || !m.values || m.values.length === 0) ? 0 : (m.values[0].value || 0);
        const getLabelVal = (m, label) => {
          if (!m || !m.values) return 0;
          const item = m.values.find(v => Object.values(v.labels).includes(label));
          return item ? item.value : 0;
        };

        // 1. ERP Score (derived from synthetic мониторинг success rate / SLO compliance)
        const probeSuccess = getVal(metricMap['synthetic_probe_success_total']);
        const probeFailure = getVal(metricMap['synthetic_probe_failure_total']);
        const totalProbes = probeSuccess + probeFailure;
        if (totalProbes > 0) {
          erpScore = Math.round((probeSuccess / totalProbes) * 100);
        } else {
          const sloCompliance = getLabelVal(metricMap['slo_compliance_ratio'], 'api_success_rate');
          if (sloCompliance > 0) {
            erpScore = Math.round(sloCompliance * 100);
          }
        }

        // 2. Browser Score (derived from browser crashes and recycles)
        const crashes = getVal(metricMap['browser_crashes_total']);
        const recycles = getVal(metricMap['browser_pool_recycle_total']);
        const totalBrowsers = crashes + recycles;
        if (totalBrowsers > 0) {
          browserScore = Math.round((recycles / totalBrowsers) * 100);
        }

        // 3. Queue Score (derived from completed vs failed bullmq jobs)
        const jobsCompleted = getVal(metricMap['bullmq_jobs_completed_total']);
        const jobsFailed = getVal(metricMap['bullmq_jobs_failed_total']);
        const totalJobs = jobsCompleted + jobsFailed;
        if (totalJobs > 0) {
          queueScore = Math.round((jobsCompleted / totalJobs) * 100);
        }

        // 4. Worker Score (derived from sync started vs failed)
        const syncFailed = getVal(metricMap['syncs_failed_total']);
        const syncStarted = getVal(metricMap['syncs_started_total']);
        if (syncStarted > 0) {
          workerScore = Math.round(((syncStarted - syncFailed) / syncStarted) * 100);
        }

        // 5. Sync Score (derived from sync completed vs failed)
        const syncsCompleted = getVal(metricMap['syncs_completed_total']);
        const totalSyncs = syncsCompleted + syncFailed;
        if (totalSyncs > 0) {
          syncScore = Math.round((syncsCompleted / totalSyncs) * 100);
        }

      } catch (err) {
        logger.error(`[ScorecardEngine] Error fetching registry metrics: ${err.message}`);
      }
    }

    const platformScore = Math.round(
      (erpScore * 0.25) +
      (browserScore * 0.20) +
      (queueScore * 0.15) +
      (workerScore * 0.15) +
      (syncScore * 0.25)
    );

    const scores = {
      erp: { score: erpScore, grade: this._toGrade(erpScore) },
      browser: { score: browserScore, grade: this._toGrade(browserScore) },
      queue: { score: queueScore, grade: this._toGrade(queueScore) },
      worker: { score: workerScore, grade: this._toGrade(workerScore) },
      sync: { score: syncScore, grade: this._toGrade(syncScore) },
      platform: { score: platformScore, grade: this._toGrade(platformScore) }
    };

    if (this.scorecardGauge) {
      this.scorecardGauge.labels('erp').set(erpScore);
      this.scorecardGauge.labels('browser').set(browserScore);
      this.scorecardGauge.labels('queue').set(queueScore);
      this.scorecardGauge.labels('worker').set(workerScore);
      this.scorecardGauge.labels('sync').set(syncScore);
      this.scorecardGauge.labels('platform').set(platformScore);
    }

    logger.info(`[ScorecardEngine] Computation complete. Platform composite score: ${platformScore} (${scores.platform.grade})`);
    return scores;
  }

  _toGrade(score) {
    if (score >= 90) return 'A';
    if (score >= 80) return 'B';
    if (score >= 70) return 'C';
    if (score >= 60) return 'D';
    return 'F';
  }
}

module.exports = ReliabilityScorecardEngine;
