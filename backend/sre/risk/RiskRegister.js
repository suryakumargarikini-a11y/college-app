'use strict';

/**
 * RiskRegister.js
 * SITAM Smart ERP — SRE Risk Management Layer
 *
 * Enterprise risk register with structured risk model, pre-populated
 * platform-specific risks, heat-map generation, trend tracking, and
 * Prometheus metric emission.
 */

const fs   = require('fs');
const path = require('path');
const EventEmitter = require('events');

// ─── Constants ───────────────────────────────────────────────────────────────

const RISK_PERSIST_PATH = path.resolve(__dirname, '../../logs/risk-register.json');

const CATEGORY = Object.freeze({
  SECURITY:           'Security',
  INFRASTRUCTURE:     'Infrastructure',
  ERP_DEPENDENCY:     'ERP_Dependency',
  DATABASE:           'Database',
  QUEUE_SYSTEMS:      'Queue_Systems',
  BROWSER_AUTOMATION: 'Browser_Automation',
  OPERATIONAL:        'Operational',
});

const RISK_LEVEL = Object.freeze({
  CRITICAL: 'CRITICAL',   // 20-25
  HIGH:     'HIGH',       // 12-19
  MEDIUM:   'MEDIUM',     // 6-11
  LOW:      'LOW',        // 1-5
});

const MITIGATION_STATUS = Object.freeze({
  NOT_STARTED:  'NOT_STARTED',
  IN_PROGRESS:  'IN_PROGRESS',
  COMPLETED:    'COMPLETED',
  ACCEPTED:     'ACCEPTED',    // risk accepted without mitigation
  TRANSFERRED:  'TRANSFERRED', // risk transferred (insurance / SLA)
});

// ─── Risk Level Calculator ────────────────────────────────────────────────────

function calcRiskLevel(score) {
  if (score >= 20) return RISK_LEVEL.CRITICAL;
  if (score >= 12) return RISK_LEVEL.HIGH;
  if (score >= 6)  return RISK_LEVEL.MEDIUM;
  return RISK_LEVEL.LOW;
}

function calcResidualRisk(probability, impact, mitigationStatus) {
  // After COMPLETED mitigation, reduce both dimensions by 30%
  if (mitigationStatus === MITIGATION_STATUS.COMPLETED) {
    return Math.round(probability * 0.7) * Math.round(impact * 0.7);
  }
  if (mitigationStatus === MITIGATION_STATUS.IN_PROGRESS) {
    return Math.round(probability * 0.85) * Math.round(impact * 0.85);
  }
  return probability * impact;
}

// ─── Pre-populated Platform Risks ────────────────────────────────────────────

const INITIAL_RISKS = [
  {
    riskId: 'RSK-001',
    title: 'ERP Portal Layout Change',
    category: CATEGORY.BROWSER_AUTOMATION,
    description: 'ERP vendor may change HTML layout/selectors, breaking browser automation scripts.',
    probability: 3, impact: 4,
    owner: 'Platform Team',
    mitigationPlan: 'Implement robust selector strategies (data-testid, ARIA), weekly layout regression tests, automated selector health checks.',
    mitigationStatus: MITIGATION_STATUS.IN_PROGRESS,
    tags: ['browser', 'erp', 'automation'],
  },
  {
    riskId: 'RSK-002',
    title: 'CAPTCHA System Escalation',
    category: CATEGORY.BROWSER_AUTOMATION,
    description: 'ERP portal escalates CAPTCHA difficulty in response to automation patterns, blocking workflows.',
    probability: 3, impact: 3,
    owner: 'Security Team',
    mitigationPlan: 'Human-like timing jitter, CAPTCHA solving service integration, session cookie rotation.',
    mitigationStatus: MITIGATION_STATUS.IN_PROGRESS,
    tags: ['captcha', 'browser', 'erp'],
  },
  {
    riskId: 'RSK-003',
    title: 'Redis Single Point of Failure',
    category: CATEGORY.INFRASTRUCTURE,
    description: 'Redis instance failure would halt all queue processing, session management, and caching.',
    probability: 2, impact: 5,
    owner: 'Infrastructure Team',
    mitigationPlan: 'Redis Sentinel or Cluster deployment, automated failover, queue persistence with AOF.',
    mitigationStatus: MITIGATION_STATUS.NOT_STARTED,
    tags: ['redis', 'infrastructure', 'spof'],
  },
  {
    riskId: 'RSK-004',
    title: 'PostgreSQL Data Loss',
    category: CATEGORY.DATABASE,
    description: 'Unplanned PostgreSQL failure without WAL archiving could result in data loss.',
    probability: 1, impact: 5,
    owner: 'Database Team',
    mitigationPlan: 'Enable WAL archiving to S3, daily pg_basebackup, PITR testing monthly, read replicas.',
    mitigationStatus: MITIGATION_STATUS.IN_PROGRESS,
    tags: ['postgresql', 'database', 'backup'],
  },
  {
    riskId: 'RSK-005',
    title: 'Secret Rotation Failure',
    category: CATEGORY.SECURITY,
    description: 'Expired or rotated secrets not propagated cause authentication failures across services.',
    probability: 2, impact: 4,
    owner: 'Security Team',
    mitigationPlan: 'HashiCorp Vault dynamic secrets, automated rotation pipeline, rotation health monitoring.',
    mitigationStatus: MITIGATION_STATUS.NOT_STARTED,
    tags: ['secrets', 'security', 'rotation'],
  },
  {
    riskId: 'RSK-006',
    title: 'ERP Credential Compromise',
    category: CATEGORY.SECURITY,
    description: 'ERP portal credentials exposed via breach or insider threat, enabling unauthorized access.',
    probability: 1, impact: 5,
    owner: 'Security Team',
    mitigationPlan: 'Credential encryption at rest, HSM storage, audit logging all credential accesses, MFA.',
    mitigationStatus: MITIGATION_STATUS.IN_PROGRESS,
    tags: ['credentials', 'security', 'erp'],
  },
  {
    riskId: 'RSK-007',
    title: 'Queue Saturation',
    category: CATEGORY.QUEUE_SYSTEMS,
    description: 'Bull queue depth exceeds processing capacity causing task backlog and SLA breaches.',
    probability: 3, impact: 3,
    owner: 'Platform Team',
    mitigationPlan: 'Queue depth alerting at 80% capacity, horizontal worker scaling, dead-letter queue.',
    mitigationStatus: MITIGATION_STATUS.IN_PROGRESS,
    tags: ['queue', 'bull', 'capacity'],
  },
  {
    riskId: 'RSK-008',
    title: 'Worker Process Crash',
    category: CATEGORY.OPERATIONAL,
    description: 'Unhandled exceptions in worker processes cause silent task drops without proper DLQ.',
    probability: 3, impact: 3,
    owner: 'Platform Team',
    mitigationPlan: 'Global error handlers, dead-letter queue, worker health checks, PM2/k8s auto-restart.',
    mitigationStatus: MITIGATION_STATUS.IN_PROGRESS,
    tags: ['worker', 'crash', 'operational'],
  },
  {
    riskId: 'RSK-009',
    title: 'Third-Party ERP API Change',
    category: CATEGORY.ERP_DEPENDENCY,
    description: 'ERP vendor changes API contract without notice, breaking integration layer.',
    probability: 4, impact: 4,
    owner: 'Integration Team',
    mitigationPlan: 'API versioning contracts, weekly integration smoke tests, vendor change notification SLA.',
    mitigationStatus: MITIGATION_STATUS.NOT_STARTED,
    tags: ['erp', 'api', 'dependency'],
  },
  {
    riskId: 'RSK-010',
    title: 'Firebase Service Outage',
    category: CATEGORY.INFRASTRUCTURE,
    description: 'Firebase regional outage disrupts auth, notifications, and real-time sync features.',
    probability: 2, impact: 3,
    owner: 'Infrastructure Team',
    mitigationPlan: 'Graceful degradation mode, local auth fallback cache, multi-region Firebase config.',
    mitigationStatus: MITIGATION_STATUS.NOT_STARTED,
    tags: ['firebase', 'infrastructure', 'outage'],
  },
  {
    riskId: 'RSK-011',
    title: 'npm Supply Chain Attack',
    category: CATEGORY.SECURITY,
    description: 'Malicious package injected into dependency tree via compromised npm package.',
    probability: 1, impact: 5,
    owner: 'Security Team',
    mitigationPlan: 'npm audit CI gate, SBOM generation, package lockfile integrity checks, Snyk integration.',
    mitigationStatus: MITIGATION_STATUS.IN_PROGRESS,
    tags: ['npm', 'supply-chain', 'security'],
  },
  {
    riskId: 'RSK-012',
    title: 'Browser Binary Compatibility',
    category: CATEGORY.BROWSER_AUTOMATION,
    description: 'Playwright/Chromium version mismatch or system binary incompatibility breaks automation.',
    probability: 2, impact: 3,
    owner: 'Platform Team',
    mitigationPlan: 'Pin browser binary versions in Docker, version matrix testing, automated browser health checks.',
    mitigationStatus: MITIGATION_STATUS.IN_PROGRESS,
    tags: ['browser', 'playwright', 'compatibility'],
  },
  {
    riskId: 'RSK-013',
    title: 'Memory Leak in Workers',
    category: CATEGORY.OPERATIONAL,
    description: 'Long-running worker processes accumulate memory causing OOM kills and task failures.',
    probability: 3, impact: 2,
    owner: 'Platform Team',
    mitigationPlan: 'Memory usage alerting, periodic worker restart schedule, heap snapshot profiling in staging.',
    mitigationStatus: MITIGATION_STATUS.IN_PROGRESS,
    tags: ['memory', 'worker', 'operational'],
  },
  {
    riskId: 'RSK-014',
    title: 'TLS Certificate Expiry',
    category: CATEGORY.SECURITY,
    description: 'TLS certificate expires silently, causing immediate service disruption.',
    probability: 2, impact: 4,
    owner: 'Infrastructure Team',
    mitigationPlan: "Let's Encrypt auto-renewal, 30-day expiry alerting, manual cert renewal runbook.",
    mitigationStatus: MITIGATION_STATUS.IN_PROGRESS,
    tags: ['tls', 'certificate', 'security'],
  },
  {
    riskId: 'RSK-015',
    title: 'DDoS on ERP Portal',
    category: CATEGORY.ERP_DEPENDENCY,
    description: 'Distributed denial-of-service attack on ERP portal makes it unreachable for automation.',
    probability: 2, impact: 4,
    owner: 'Security Team',
    mitigationPlan: 'Rate limiting, circuit breaker pattern, ERP request queuing, vendor DDoS protection SLA.',
    mitigationStatus: MITIGATION_STATUS.NOT_STARTED,
    tags: ['ddos', 'erp', 'security'],
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function _ts() { return new Date().toISOString(); }

function _buildRisk(raw) {
  const severity     = raw.probability * raw.impact;
  const riskScore    = severity; // 1-25
  const riskLevel    = calcRiskLevel(riskScore);
  const residualRisk = calcResidualRisk(raw.probability, raw.impact, raw.mitigationStatus);
  const now          = _ts();

  return {
    riskId:           raw.riskId,
    title:            raw.title,
    category:         raw.category,
    description:      raw.description,
    probability:      raw.probability,   // 1-5
    impact:           raw.impact,        // 1-5
    severity,                            // probability × impact
    riskScore,                           // 0-25
    riskLevel,
    owner:            raw.owner,
    mitigationPlan:   raw.mitigationPlan || '',
    mitigationStatus: raw.mitigationStatus || MITIGATION_STATUS.NOT_STARTED,
    residualRisk,
    reviewDate:       raw.reviewDate || null,
    tags:             raw.tags || [],
    createdAt:        raw.createdAt || now,
    updatedAt:        now,
    scoreHistory:     raw.scoreHistory || [{ score: riskScore, recordedAt: now }],
  };
}

// ─── Main Class ───────────────────────────────────────────────────────────────

class RiskRegister extends EventEmitter {
  /**
   * @param {Object} options
   * @param {Object} [options.logger]   Logger (defaults to console)
   * @param {Object} [options.metrics]  Prometheus registry
   * @param {boolean} [options.persist] Persist on mutation (default: true)
   */
  constructor(options = {}) {
    super();
    this.logger   = options.logger  || console;
    this.metrics  = options.metrics || null;
    this._persist = options.persist !== false;

    /** @type {Map<string, Object>} riskId → risk record */
    this._risks = new Map();
    this._prometheusMetrics = {};

    // Load persisted data or seed initial risks
    if (!this._loadFromDisk()) {
      this._seedInitialRisks();
    }

    this._initMetrics();
    this._publishMetrics();
  }

  // ── Seeding ─────────────────────────────────────────────────────────────────

  _seedInitialRisks() {
    for (const raw of INITIAL_RISKS) {
      this._risks.set(raw.riskId, _buildRisk(raw));
    }
    this.logger.info(`[RiskRegister] Seeded ${this._risks.size} initial platform risks.`);
    if (this._persist) this._saveToDisk();
  }

  // ── Metrics ─────────────────────────────────────────────────────────────────

  _initMetrics() {
    if (!this.metrics) return;
    try {
      const { Gauge } = require('prom-client');
      this._prometheusMetrics.riskCount = new Gauge({
        name: 'risk_count',
        help: 'Number of risks per risk level',
        labelNames: ['level'],
        registers: [this.metrics],
      });
      this._prometheusMetrics.exposureScore = new Gauge({
        name: 'risk_exposure_score',
        help: 'Aggregate risk exposure score (0-100)',
        registers: [this.metrics],
      });
    } catch { /* prom-client not available */ }
  }

  _publishMetrics() {
    if (!this._prometheusMetrics.riskCount) return;
    for (const level of Object.values(RISK_LEVEL)) {
      this._prometheusMetrics.riskCount.labels(level).set(
        this._riskArray().filter(r => r.riskLevel === level).length
      );
    }
    this._prometheusMetrics.exposureScore.set(this.getOverallRiskExposure());
  }

  _riskArray() {
    return [...this._risks.values()];
  }

  // ── CRUD ────────────────────────────────────────────────────────────────────

  /**
   * Add a new risk to the register.
   * @param {Object} risk  Risk fields (riskId optional — auto-generated)
   * @returns {Object} Created risk record
   */
  addRisk(risk) {
    if (!risk.riskId) {
      risk.riskId = `RSK-${String(this._risks.size + 1).padStart(3, '0')}`;
    }
    if (this._risks.has(risk.riskId)) {
      throw new Error(`Risk already exists: ${risk.riskId}`);
    }
    const record = _buildRisk(risk);
    this._risks.set(record.riskId, record);

    this.emit('riskAdded', record);
    this.logger.info(`[RiskRegister] Added risk ${record.riskId}: ${record.title} [${record.riskLevel}]`);

    if (this._persist) this._saveToDisk();
    this._publishMetrics();
    return record;
  }

  /**
   * Update an existing risk.
   * @param {string} riskId
   * @param {Object} updates  Partial risk fields
   * @returns {Object} Updated risk record
   */
  updateRisk(riskId, updates) {
    const existing = this._risks.get(riskId);
    if (!existing) throw new Error(`Risk not found: ${riskId}`);

    const merged = { ...existing, ...updates, riskId };
    const record  = _buildRisk(merged);
    // Preserve history
    record.scoreHistory = [
      ...(existing.scoreHistory || []),
      { score: record.riskScore, recordedAt: _ts() },
    ].slice(-90); // keep last 90 data points
    record.createdAt = existing.createdAt;

    this._risks.set(riskId, record);
    this.emit('riskUpdated', record);
    this.logger.info(`[RiskRegister] Updated risk ${riskId} → level: ${record.riskLevel}`);

    if (this._persist) this._saveToDisk();
    this._publishMetrics();
    return record;
  }

  /**
   * Retrieve a single risk.
   * @param {string} riskId
   * @returns {Object|null}
   */
  getRisk(riskId) {
    return this._risks.get(riskId) || null;
  }

  // ── Filtering ───────────────────────────────────────────────────────────────

  /**
   * Get all risks in a category.
   * @param {string} category  e.g. 'Security'
   */
  getRisksByCategory(category) {
    return this._riskArray().filter(r => r.category === category);
  }

  /**
   * Get all risks at a given risk level.
   * @param {string} level  e.g. 'CRITICAL'
   */
  getRisksByLevel(level) {
    return this._riskArray().filter(r => r.riskLevel === level);
  }

  /**
   * Returns top N risks by risk score (descending).
   * @param {number} n
   */
  getTopRisks(n = 5) {
    return this._riskArray()
      .sort((a, b) => b.riskScore - a.riskScore)
      .slice(0, n);
  }

  // ── Analysis ────────────────────────────────────────────────────────────────

  /**
   * Returns a 5×5 heat-map matrix (probability × impact).
   * Each cell contains the risk IDs that fall in that bucket.
   * Matrix[probability-1][impact-1] → { count, risks: [] }
   */
  getRiskHeatmap() {
    // Initialize 5×5 matrix
    const matrix = Array.from({ length: 5 }, () =>
      Array.from({ length: 5 }, () => ({ count: 0, risks: [] }))
    );

    for (const risk of this._riskArray()) {
      const p = Math.min(Math.max(risk.probability, 1), 5) - 1;
      const i = Math.min(Math.max(risk.impact, 1), 5) - 1;
      matrix[p][i].count++;
      matrix[p][i].risks.push({ riskId: risk.riskId, title: risk.title, riskLevel: risk.riskLevel });
    }

    return {
      axes: { x: 'Impact (1-5)', y: 'Probability (1-5)' },
      legend: {
        CRITICAL: '20-25 (Red)',
        HIGH:     '12-19 (Orange)',
        MEDIUM:   '6-11 (Yellow)',
        LOW:      '1-5 (Green)',
      },
      matrix,
    };
  }

  /**
   * Returns risk score trend — average daily score over the last N days
   * from history entries.
   * @param {number} days
   */
  getRiskTrend(days = 30) {
    const now     = Date.now();
    const cutoff  = now - days * 24 * 60 * 60 * 1000;
    const buckets = {};

    for (const risk of this._riskArray()) {
      for (const entry of (risk.scoreHistory || [])) {
        const ts = new Date(entry.recordedAt).getTime();
        if (ts >= cutoff) {
          const day = new Date(ts).toISOString().split('T')[0];
          if (!buckets[day]) buckets[day] = { total: 0, count: 0 };
          buckets[day].total += entry.score;
          buckets[day].count++;
        }
      }
    }

    return Object.entries(buckets)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, data]) => ({
        date,
        averageRiskScore: Math.round(data.total / data.count),
        dataPoints: data.count,
      }));
  }

  // ── Aggregate Score ──────────────────────────────────────────────────────────

  /**
   * Aggregate risk exposure score 0-100.
   * Formula: (sum of all riskScores) / (count × 25) × 100
   */
  getOverallRiskExposure() {
    const risks = this._riskArray();
    if (risks.length === 0) return 0;
    const totalPossible = risks.length * 25;
    const totalActual   = risks.reduce((acc, r) => acc + r.riskScore, 0);
    return Math.round((totalActual / totalPossible) * 100);
  }

  // ── Reporting ────────────────────────────────────────────────────────────────

  /**
   * Generates a full structured risk report.
   */
  generateReport() {
    const risks   = this._riskArray();
    const topRisks = this.getTopRisks(10);
    const byLevel  = {};
    for (const level of Object.values(RISK_LEVEL)) {
      byLevel[level] = risks.filter(r => r.riskLevel === level).length;
    }
    const byCategory = {};
    for (const cat of Object.values(CATEGORY)) {
      byCategory[cat] = risks.filter(r => r.category === cat).length;
    }

    return {
      reportId:            `RISK-${Date.now()}`,
      generatedAt:         _ts(),
      totalRisks:          risks.length,
      overallExposureScore: this.getOverallRiskExposure(),
      byLevel,
      byCategory,
      notStartedMitigation: risks.filter(r => r.mitigationStatus === MITIGATION_STATUS.NOT_STARTED).length,
      inProgressMitigation: risks.filter(r => r.mitigationStatus === MITIGATION_STATUS.IN_PROGRESS).length,
      completedMitigation:  risks.filter(r => r.mitigationStatus === MITIGATION_STATUS.COMPLETED).length,
      topRisks,
      heatmap: this.getRiskHeatmap(),
      trend:   this.getRiskTrend(30),
      risks,
    };
  }

  // ── Persistence ──────────────────────────────────────────────────────────────

  _saveToDisk() {
    try {
      fs.mkdirSync(path.dirname(RISK_PERSIST_PATH), { recursive: true });
      const payload = { savedAt: _ts(), risks: [...this._risks.values()] };
      fs.writeFileSync(RISK_PERSIST_PATH, JSON.stringify(payload, null, 2), 'utf8');
    } catch (e) {
      this.logger.warn(`[RiskRegister] Failed to persist: ${e.message}`);
    }
  }

  _loadFromDisk() {
    if (!fs.existsSync(RISK_PERSIST_PATH)) return false;
    try {
      const data = JSON.parse(fs.readFileSync(RISK_PERSIST_PATH, 'utf8'));
      if (!Array.isArray(data.risks) || data.risks.length === 0) return false;
      for (const r of data.risks) {
        this._risks.set(r.riskId, r);
      }
      this.logger.info(`[RiskRegister] Loaded ${this._risks.size} risks from disk.`);
      return true;
    } catch (e) {
      this.logger.warn(`[RiskRegister] Failed to load from disk: ${e.message}`);
      return false;
    }
  }
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = { RiskRegister, CATEGORY, RISK_LEVEL, MITIGATION_STATUS };
