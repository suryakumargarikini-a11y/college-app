'use strict';

/**
 * RiskForecastEngine.js
 * SITAM Smart ERP — SRE Risk Management Layer
 *
 * Analyzes risk register trends, correlates with incident history, and
 * generates forward-looking risk forecasts with category-level mitigation
 * recommendations. Emits Prometheus metrics for dashboarding.
 */

const EventEmitter = require('events');

// ─── Constants ────────────────────────────────────────────────────────────────

/** A risk whose score increased across its last N history samples is "growing" */
const GROWING_MIN_SAMPLES = 3;

/** Risks not mitigated for this many days are "unresolved" */
const UNRESOLVED_DAYS_THRESHOLD = 90;

/** More than this many incidents per category per month = "recurring" */
const RECURRING_INCIDENTS_THRESHOLD = 2;

/** Mitigation recommendations per category */
const MITIGATION_RECOMMENDATIONS = {
  Security: [
    'Implement automated secret rotation with HashiCorp Vault',
    'Enable mandatory security review for all PRs touching auth code',
    'Schedule quarterly penetration testing',
    'Deploy runtime application self-protection (RASP)',
    'Run npm audit in CI and gate on critical/high findings',
  ],
  Infrastructure: [
    'Move to Redis Sentinel or Cluster to eliminate SPOF',
    'Enable WAL archiving for PostgreSQL with PITR capability',
    'Implement cross-region failover for Firebase',
    'Deploy infrastructure health checks with auto-remediation',
    'Establish runbooks for all infrastructure failure modes',
  ],
  ERP_Dependency: [
    'Negotiate SLA with ERP vendor for advance API change notification',
    'Build API adapter layer to insulate integration from vendor changes',
    'Implement weekly smoke-test suite against ERP sandbox',
    'Deploy circuit breaker pattern for all ERP calls',
    'Monitor ERP portal change log / changelog feed',
  ],
  Database: [
    'Enable point-in-time recovery (PITR) on PostgreSQL',
    'Schedule daily pg_basebackup and test monthly',
    'Implement read replicas for read-heavy workloads',
    'Set up automated backup integrity verification',
    'Create database failover runbook with RTO/RPO targets',
  ],
  Queue_Systems: [
    'Configure dead-letter queues for all Bull queues',
    'Add queue depth alerting at 80% capacity threshold',
    'Implement horizontal worker scaling based on queue depth',
    'Enable queue persistence with Redis AOF mode',
    'Add queue health dashboard with SLO tracking',
  ],
  Browser_Automation: [
    'Implement data-testid selectors to decouple from HTML structure',
    'Deploy weekly layout regression test suite against ERP',
    'Pin Playwright/Chromium versions in Docker images',
    'Add browser trust score monitoring with automatic fallback',
    'Integrate CAPTCHA solving service with rate-aware throttling',
  ],
  Operational: [
    'Implement global process error handlers on all workers',
    'Deploy PM2/k8s auto-restart with exponential backoff',
    'Add memory usage alerting and periodic worker recycling',
    'Build operational runbooks for all known failure modes',
    'Schedule monthly chaos engineering exercises',
  ],
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function _ts() { return new Date().toISOString(); }
function _daysAgo(n) { return new Date(Date.now() - n * 86_400_000); }

// ─── Main Class ───────────────────────────────────────────────────────────────

class RiskForecastEngine extends EventEmitter {
  /**
   * @param {Object} options
   * @param {Object} options.riskRegister     - RiskRegister instance (required)
   * @param {Object} [options.incidentManager] - IncidentManager instance (optional)
   * @param {Object} [options.logger]
   * @param {Object} [options.metrics]        - Prometheus registry
   */
  constructor(options = {}) {
    super();

    if (!options.riskRegister) {
      throw new Error('[RiskForecastEngine] riskRegister is required');
    }

    this.riskRegister    = options.riskRegister;
    this.incidentManager = options.incidentManager || null;
    this.logger          = options.logger || console;
    this.metrics         = options.metrics || null;

    this._lastForecast   = null;
    this._predictions    = [];
    this._prometheusMetrics = {};
    this._initMetrics();
  }

  // ── Metrics ─────────────────────────────────────────────────────────────────

  _initMetrics() {
    if (!this.metrics) return;
    try {
      const { Gauge } = require('prom-client');
      this._prometheusMetrics.forecastHighCount = new Gauge({
        name: 'risk_forecast_high_count',
        help: 'Number of HIGH/CRITICAL risks forecasted to worsen',
        registers: [this.metrics],
      });
      this._prometheusMetrics.unresolvedTotal = new Gauge({
        name: 'risk_unresolved_total',
        help: 'Total number of risks unresolved for >' + UNRESOLVED_DAYS_THRESHOLD + ' days',
        registers: [this.metrics],
      });
    } catch { /* prom-client not available */ }
  }

  _publishMetrics(growing, unresolved) {
    if (!this._prometheusMetrics.forecastHighCount) return;
    this._prometheusMetrics.forecastHighCount.set(
      growing.filter(r => r.riskLevel === 'HIGH' || r.riskLevel === 'CRITICAL').length
    );
    this._prometheusMetrics.unresolvedTotal.set(unresolved.length);
  }

  // ── Core Forecast ────────────────────────────────────────────────────────────

  /**
   * Run a full risk forecast. Persists results internally.
   * @returns {Object} Forecast report
   */
  async forecast() {
    this.logger.info('[RiskForecastEngine] Running risk forecast...');
    const startedAt = Date.now();

    const growing   = this.getGrowingRisks();
    const unresolved = this.getUnresolvedRisks();
    const recurring  = await this.getRecurringRisks();
    const recs       = this.getMitigationRecommendations();

    this._publishMetrics(growing, unresolved);

    const result = {
      forecastId:   `RFCAST-${Date.now()}`,
      forecastedAt: _ts(),
      elapsedMs:    Date.now() - startedAt,
      summary: {
        growingRisks:    growing.length,
        unresolvedRisks: unresolved.length,
        recurringRisks:  recurring.length,
        topCategories:   this._topCategories([...growing, ...unresolved]),
      },
      growingRisks: growing,
      unresolvedRisks: unresolved,
      recurringRisks: recurring,
      recommendations: recs,
    };

    this._lastForecast = result;
    this.emit('forecast', result);
    this.logger.info(
      `[RiskForecastEngine] Forecast complete — growing: ${growing.length}, unresolved: ${unresolved.length}, recurring: ${recurring.length}`
    );
    return result;
  }

  // ── Growing Risks ────────────────────────────────────────────────────────────

  /**
   * Identifies risks whose riskScore has been increasing across recent history.
   * A risk is "growing" if score increased in ≥50% of consecutive pairs in last N samples.
   */
  getGrowingRisks() {
    const allRisks = typeof this.riskRegister.getAllRisks === 'function'
      ? this.riskRegister.getAllRisks()
      : [...(this.riskRegister._risks?.values() || [])];

    const growing = [];
    for (const risk of allRisks) {
      const history = (risk.scoreHistory || []).slice(-GROWING_MIN_SAMPLES);
      if (history.length < 2) continue;

      let increases = 0;
      for (let i = 1; i < history.length; i++) {
        if (history[i].score > history[i - 1].score) increases++;
      }
      const trend = increases / (history.length - 1);
      if (trend >= 0.5) {
        growing.push({
          riskId:    risk.riskId,
          title:     risk.title,
          category:  risk.category,
          riskLevel: risk.riskLevel,
          riskScore: risk.riskScore,
          trendStrength: Math.round(trend * 100),
          history:   history.slice(-5),
          forecast:  'Score trending upward — escalation likely without mitigation',
        });
      }
    }

    return growing.sort((a, b) => b.riskScore - a.riskScore);
  }

  // ── Unresolved Risks ─────────────────────────────────────────────────────────

  /**
   * Identifies risks that have not been mitigated within the threshold period.
   */
  getUnresolvedRisks() {
    const allRisks = typeof this.riskRegister.getAllRisks === 'function'
      ? this.riskRegister.getAllRisks()
      : [...(this.riskRegister._risks?.values() || [])];

    const cutoff  = _daysAgo(UNRESOLVED_DAYS_THRESHOLD);
    const unresolved = [];

    for (const risk of allRisks) {
      const isResolved = ['COMPLETED', 'ACCEPTED', 'TRANSFERRED'].includes(risk.mitigationStatus);
      if (isResolved) continue;

      const createdAt = new Date(risk.createdAt);
      const ageDays   = Math.floor((Date.now() - createdAt.getTime()) / 86_400_000);

      if (createdAt < cutoff) {
        unresolved.push({
          riskId:           risk.riskId,
          title:            risk.title,
          category:         risk.category,
          riskLevel:        risk.riskLevel,
          riskScore:        risk.riskScore,
          mitigationStatus: risk.mitigationStatus,
          ageDays,
          owner:            risk.owner,
          recommendation:   'Escalate to risk owner — unresolved beyond ' + UNRESOLVED_DAYS_THRESHOLD + '-day threshold',
        });
      }
    }

    return unresolved.sort((a, b) => b.ageDays - a.ageDays);
  }

  // ── Recurring Risks ──────────────────────────────────────────────────────────

  /**
   * Identifies categories with recurring incidents (>2/month) from incident history.
   * Falls back to empty array if no incident manager is available.
   */
  async getRecurringRisks() {
    if (!this.incidentManager) {
      return this._syntheticRecurringRisks();
    }

    let incidents = [];
    try {
      if (typeof this.incidentManager.getRecentIncidents === 'function') {
        incidents = await this.incidentManager.getRecentIncidents(30);
      } else if (typeof this.incidentManager.getIncidents === 'function') {
        const all = this.incidentManager.getIncidents();
        const cutoff = _daysAgo(30);
        incidents = all.filter(i => new Date(i.detectedAt || i.createdAt) >= cutoff);
      }
    } catch (e) {
      this.logger.warn(`[RiskForecastEngine] Could not fetch incidents: ${e.message}`);
    }

    // Group by category tag
    const countByCategory = {};
    for (const inc of incidents) {
      const cat = inc.category || inc.service || 'Unknown';
      countByCategory[cat] = (countByCategory[cat] || 0) + 1;
    }

    return Object.entries(countByCategory)
      .filter(([, count]) => count > RECURRING_INCIDENTS_THRESHOLD)
      .map(([category, count]) => ({
        category,
        incidentCount: count,
        period: 'last 30 days',
        threshold: RECURRING_INCIDENTS_THRESHOLD,
        forecast: `${category} is exhibiting recurring incidents — systemic root cause suspected`,
        recommendations: MITIGATION_RECOMMENDATIONS[category] || ['Conduct blameless postmortem', 'Identify systemic root cause'],
      }));
  }

  /** Returns synthetic recurring risk signals based on risk register alone */
  _syntheticRecurringRisks() {
    const allRisks = typeof this.riskRegister.getAllRisks === 'function'
      ? this.riskRegister.getAllRisks()
      : [...(this.riskRegister._risks?.values() || [])];

    // Categories with HIGH/CRITICAL risks and NOT_STARTED mitigation are likely recurring
    const countByCategory = {};
    for (const risk of allRisks) {
      if (['CRITICAL', 'HIGH'].includes(risk.riskLevel) && risk.mitigationStatus === 'NOT_STARTED') {
        countByCategory[risk.category] = (countByCategory[risk.category] || 0) + 1;
      }
    }

    return Object.entries(countByCategory)
      .filter(([, count]) => count >= 2)
      .map(([category, count]) => ({
        category,
        unresolvedHighRisks: count,
        period: 'current',
        threshold: 2,
        forecast: `${category} has ${count} HIGH/CRITICAL risks without active mitigation — recurring incident pattern likely`,
        recommendations: MITIGATION_RECOMMENDATIONS[category] || ['Define and execute mitigation plan'],
      }));
  }

  // ── Recommendations ──────────────────────────────────────────────────────────

  /**
   * Returns mitigation recommendations for each risk category.
   */
  getMitigationRecommendations() {
    const allRisks = typeof this.riskRegister.getAllRisks === 'function'
      ? this.riskRegister.getAllRisks()
      : [...(this.riskRegister._risks?.values() || [])];

    // Determine which categories have active (unresolved) risks
    const activeCategories = new Set(
      allRisks
        .filter(r => !['COMPLETED', 'ACCEPTED'].includes(r.mitigationStatus))
        .map(r => r.category)
    );

    const recs = [];
    for (const cat of activeCategories) {
      const categoryRisks  = allRisks.filter(r => r.category === cat);
      const maxScore       = Math.max(...categoryRisks.map(r => r.riskScore));
      const criticalCount  = categoryRisks.filter(r => r.riskLevel === 'CRITICAL').length;
      const highCount      = categoryRisks.filter(r => r.riskLevel === 'HIGH').length;

      recs.push({
        category:          cat,
        riskCount:         categoryRisks.length,
        maxRiskScore:      maxScore,
        criticalRisks:     criticalCount,
        highRisks:         highCount,
        priority:          criticalCount > 0 ? 'CRITICAL' : highCount > 0 ? 'HIGH' : 'MEDIUM',
        recommendations:   MITIGATION_RECOMMENDATIONS[cat] || ['Review and remediate outstanding risks'],
        topRisks:          categoryRisks
          .sort((a, b) => b.riskScore - a.riskScore)
          .slice(0, 3)
          .map(r => ({ riskId: r.riskId, title: r.title, riskScore: r.riskScore, riskLevel: r.riskLevel })),
      });
    }

    return recs.sort((a, b) => b.maxRiskScore - a.maxRiskScore);
  }

  // ── Report ───────────────────────────────────────────────────────────────────

  /**
   * Returns the last computed forecast report, or generates a fresh one.
   */
  getForecastReport() {
    return this._lastForecast || { status: 'NOT_COMPUTED', message: 'Call forecast() first' };
  }

  // ── Private Helpers ──────────────────────────────────────────────────────────

  _topCategories(risks) {
    const counts = {};
    for (const r of risks) {
      counts[r.category] = (counts[r.category] || 0) + 1;
    }
    return Object.entries(counts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([cat, count]) => ({ category: cat, count }));
  }
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = { RiskForecastEngine };
