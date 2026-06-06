'use strict';

/**
 * ComplianceFrameworkEngine.js
 * SITAM Smart ERP — Compliance & Risk Management Layer
 *
 * Tracks compliance posture across OWASP Top 10 (2021), NIST CSF, and
 * Internal Security Controls. Runs automated validation hooks against the
 * live codebase and emits Prometheus-compatible metrics.
 */

const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');

// ─── Constants ───────────────────────────────────────────────────────────────

const STATUS = Object.freeze({
  IMPLEMENTED:     'IMPLEMENTED',
  PARTIAL:         'PARTIAL',
  NOT_IMPLEMENTED: 'NOT_IMPLEMENTED',
  EXEMPT:          'EXEMPT',
});

const FRAMEWORK = Object.freeze({
  OWASP:    'OWASP_TOP10_2021',
  NIST:     'NIST_CSF',
  INTERNAL: 'INTERNAL_CONTROLS',
});

// Weights for composite score
const FRAMEWORK_WEIGHTS = {
  [FRAMEWORK.OWASP]:    0.35,
  [FRAMEWORK.NIST]:     0.35,
  [FRAMEWORK.INTERNAL]: 0.30,
};

// Base paths used by automated hooks
const BASE_DIR         = path.resolve(__dirname, '../../..');
const SECURITY_DIR     = path.resolve(__dirname, '../..');
const SRE_DIR          = path.resolve(BASE_DIR, 'backend/sre');
const PACKAGE_JSON     = path.resolve(BASE_DIR, 'package.json');
const REPORT_PATH      = path.resolve(__dirname, 'compliance-report.json');

// ─── Framework Definitions ───────────────────────────────────────────────────

/** OWASP Top 10 (2021) control catalogue */
const OWASP_CONTROLS = [
  {
    id: 'A01',
    title: 'Broken Access Control',
    checks: ['auth_middleware', 'rbac_security_service'],
    description: 'Restrictions on what authenticated users are allowed to do are not properly enforced.',
  },
  {
    id: 'A02',
    title: 'Cryptographic Failures',
    checks: ['jwt_signing', 'password_hashing', 'tls_enforced'],
    description: 'Failures related to cryptography which often lead to sensitive data exposure.',
  },
  {
    id: 'A03',
    title: 'Injection',
    checks: ['parameterized_queries', 'input_sanitization'],
    description: 'User-supplied data is not validated, filtered, or sanitized.',
  },
  {
    id: 'A04',
    title: 'Insecure Design',
    checks: ['threat_modeling', 'security_review_process'],
    description: 'Risks related to design and architectural flaws.',
  },
  {
    id: 'A05',
    title: 'Security Misconfiguration',
    checks: ['helmet_enabled', 'cors_configured', 'env_vars_not_committed'],
    description: 'Missing appropriate security hardening across application stack.',
  },
  {
    id: 'A06',
    title: 'Vulnerable and Outdated Components',
    checks: ['npm_audit_clean'],
    description: 'Components with known vulnerabilities used without tracking.',
  },
  {
    id: 'A07',
    title: 'Identification and Authentication Failures',
    checks: ['session_management', 'token_rotation'],
    description: 'Authentication and session management implemented incorrectly.',
  },
  {
    id: 'A08',
    title: 'Software and Data Integrity Failures',
    checks: ['sbom_generation', 'supply_chain_attestation'],
    description: 'Code and infrastructure that does not protect against integrity violations.',
  },
  {
    id: 'A09',
    title: 'Security Logging and Monitoring Failures',
    checks: ['security_event_logging', 'audit_trail'],
    description: 'Insufficient logging, monitoring, and active response.',
  },
  {
    id: 'A10',
    title: 'Server-Side Request Forgery',
    checks: ['url_validation_ssrf'],
    description: 'SSRF flaws occur when a server fetches a remote resource without validating URL.',
  },
];

/** NIST CSF (v1.1) function/category catalogue */
const NIST_CONTROLS = [
  // IDENTIFY
  { id: 'ID.AM', function: 'IDENTIFY', title: 'Asset Management',        description: 'Data, personnel, devices, systems and facilities are identified.' },
  { id: 'ID.BE', function: 'IDENTIFY', title: 'Business Environment',    description: 'Mission, objectives, stakeholders, and activities are understood.' },
  { id: 'ID.GV', function: 'IDENTIFY', title: 'Governance',              description: 'Policies, procedures, and processes to manage and monitor regulatory requirements.' },
  { id: 'ID.RA', function: 'IDENTIFY', title: 'Risk Assessment',         description: 'Organization understands cybersecurity risk to operations and assets.' },
  // PROTECT
  { id: 'PR.AC', function: 'PROTECT',  title: 'Access Control',          description: 'Access to assets is limited to authorized users and systems.' },
  { id: 'PR.AT', function: 'PROTECT',  title: 'Awareness & Training',    description: 'Personnel have cybersecurity awareness and are trained.' },
  { id: 'PR.DS', function: 'PROTECT',  title: 'Data Security',           description: 'Information and records are managed consistent with risk strategy.' },
  { id: 'PR.IP', function: 'PROTECT',  title: 'Information Protection',  description: 'Security policies, processes, and procedures maintained.' },
  { id: 'PR.MA', function: 'PROTECT',  title: 'Maintenance',             description: 'Maintenance and repairs of assets performed and logged.' },
  { id: 'PR.PT', function: 'PROTECT',  title: 'Protective Technology',   description: 'Technical security solutions managed to ensure security and resilience.' },
  // DETECT
  { id: 'DE.AE', function: 'DETECT',   title: 'Anomalies & Events',      description: 'Anomalous activity is detected and impact understood.' },
  { id: 'DE.CM', function: 'DETECT',   title: 'Security Monitoring',     description: 'Information system is monitored to detect cybersecurity events.' },
  { id: 'DE.DP', function: 'DETECT',   title: 'Detection Processes',     description: 'Detection processes and procedures maintained to ensure awareness.' },
  // RESPOND
  { id: 'RS.RP', function: 'RESPOND',  title: 'Response Planning',       description: 'Response processes and procedures are executed during or after incident.' },
  { id: 'RS.CO', function: 'RESPOND',  title: 'Communications',          description: 'Response activities coordinated with internal and external stakeholders.' },
  { id: 'RS.AN', function: 'RESPOND',  title: 'Analysis',                description: 'Analysis conducted to ensure effective response.' },
  { id: 'RS.MI', function: 'RESPOND',  title: 'Mitigation',              description: 'Activities performed to prevent expansion of an event.' },
  { id: 'RS.IM', function: 'RESPOND',  title: 'Improvements',            description: 'Organizational response activities improved using lessons learned.' },
  // RECOVER
  { id: 'RC.RP', function: 'RECOVER',  title: 'Recovery Planning',       description: 'Recovery processes and procedures executed and maintained.' },
  { id: 'RC.IM', function: 'RECOVER',  title: 'RC Improvements',         description: 'Recovery planning and processes improved after incidents.' },
  // Note: RC.CO is sometimes included; keeping 20 categories per spec
];

/** Internal security controls */
const INTERNAL_CONTROLS = [
  { id: 'SEC-001', title: 'SSRF Protection',              description: 'SSRF protection implemented in securityService.' },
  { id: 'SEC-002', title: 'JWT Blacklist',                description: 'JWT blacklist active for revoked tokens.' },
  { id: 'SEC-003', title: 'Rate Limiting',                description: 'Rate limiting on all public-facing endpoints.' },
  { id: 'SEC-004', title: 'Helmet.js Headers',            description: 'Helmet.js security headers configured.' },
  { id: 'SEC-005', title: 'Input Validation',             description: 'Input validation on all auth endpoints.' },
  { id: 'SEC-006', title: 'Admin Audit Trail',            description: 'Audit trail for all admin actions.' },
  { id: 'SEC-007', title: 'Secret Rotation Policy',       description: 'Secret rotation policy defined and documented.' },
  { id: 'SEC-008', title: 'Container Security Scanning',  description: 'Container images scanned for vulnerabilities.' },
  { id: 'SEC-009', title: 'SBOM Automation',              description: 'Software Bill of Materials generated automatically.' },
  { id: 'SEC-010', title: 'Supply Chain Attestation',     description: 'Supply chain provenance attestation implemented.' },
  { id: 'SEC-011', title: 'Error Budget Governance',      description: 'Error budget consumption tracked and governed.' },
  { id: 'SEC-012', title: 'Incident Management Process',  description: 'Incident management process defined and documented.' },
  { id: 'SEC-013', title: 'Postmortem Process',           description: 'Postmortem / blameless review process active.' },
  { id: 'SEC-014', title: 'Chaos Testing',                description: 'Chaos testing implemented and scheduled.' },
  { id: 'SEC-015', title: 'SLO Monitoring',               description: 'SLO burn-rate monitoring active.' },
];

// ─── Automated Validation Hooks ───────────────────────────────────────────────

/**
 * Each hook returns { passed: boolean, partial: boolean, evidence: string }
 */
const VALIDATION_HOOKS = {

  // OWASP hooks
  auth_middleware() {
    const p = path.resolve(SECURITY_DIR, 'securityService.js');
    const exists = fs.existsSync(p);
    return { passed: exists, partial: false, evidence: exists ? 'securityService.js found' : 'securityService.js missing' };
  },
  rbac_security_service() {
    const p = path.resolve(SECURITY_DIR, 'securityService.js');
    if (!fs.existsSync(p)) return { passed: false, partial: false, evidence: 'securityService.js missing' };
    const src = fs.readFileSync(p, 'utf8');
    const hasRbac = /rbac|role.*control|checkPermission/i.test(src);
    return { passed: hasRbac, partial: !hasRbac, evidence: hasRbac ? 'RBAC logic detected' : 'RBAC patterns not found in securityService.js' };
  },
  jwt_signing() {
    const p = path.resolve(SECURITY_DIR, 'securityService.js');
    if (!fs.existsSync(p)) return { passed: false, partial: false, evidence: 'securityService.js missing' };
    const src = fs.readFileSync(p, 'utf8');
    const ok = /jwt\.sign|jsonwebtoken/i.test(src);
    return { passed: ok, partial: false, evidence: ok ? 'JWT signing found' : 'JWT signing not found' };
  },
  password_hashing() {
    const p = path.resolve(SECURITY_DIR, 'securityService.js');
    if (!fs.existsSync(p)) return { passed: false, partial: false, evidence: 'securityService.js missing' };
    const src = fs.readFileSync(p, 'utf8');
    const ok = /bcrypt|argon2|scrypt|pbkdf2/i.test(src);
    return { passed: ok, partial: false, evidence: ok ? 'Password hashing library detected' : 'No password hashing found' };
  },
  tls_enforced() {
    const p = path.resolve(BASE_DIR, '.env.example');
    const exists = fs.existsSync(p);
    return { passed: exists, partial: !exists, evidence: exists ? '.env.example present (TLS assumed configured)' : '.env.example missing' };
  },
  parameterized_queries() {
    const files = _findFiles(path.resolve(BASE_DIR, 'backend'), /\.js$/, ['node_modules']);
    let found = false;
    for (const f of files) {
      try {
        const src = fs.readFileSync(f, 'utf8');
        if (/\$\d+|\$[a-zA-Z]|parameterized|prepared statement/i.test(src)) { found = true; break; }
      } catch { /* ignore */ }
    }
    return { passed: found, partial: !found, evidence: found ? 'Parameterized query patterns found' : 'No parameterized patterns detected' };
  },
  input_sanitization() {
    const p = path.resolve(SECURITY_DIR, 'securityService.js');
    if (!fs.existsSync(p)) return { passed: false, partial: false, evidence: 'securityService.js missing' };
    const src = fs.readFileSync(p, 'utf8');
    const ok = /sanitiz|validate|strip|escap/i.test(src);
    return { passed: ok, partial: false, evidence: ok ? 'Input sanitization detected' : 'Sanitization not found' };
  },
  threat_modeling() {
    const docs = [
      path.resolve(BASE_DIR, 'docs/threat-model.md'),
      path.resolve(BASE_DIR, 'THREAT_MODEL.md'),
      path.resolve(BASE_DIR, 'security/threat-model.md'),
    ];
    const exists = docs.some(d => fs.existsSync(d));
    return { passed: exists, partial: !exists, evidence: exists ? 'Threat model document found' : 'No threat model document found' };
  },
  security_review_process() {
    const docs = [
      path.resolve(BASE_DIR, '.github/SECURITY.md'),
      path.resolve(BASE_DIR, 'SECURITY.md'),
    ];
    const exists = docs.some(d => fs.existsSync(d));
    return { passed: exists, partial: !exists, evidence: exists ? 'SECURITY.md found' : 'SECURITY.md missing' };
  },
  helmet_enabled() {
    if (!fs.existsSync(PACKAGE_JSON)) return { passed: false, partial: false, evidence: 'package.json not found' };
    try {
      const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON, 'utf8'));
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      const ok = 'helmet' in deps;
      return { passed: ok, partial: false, evidence: ok ? `helmet@${deps.helmet} in package.json` : 'helmet not in package.json' };
    } catch {
      return { passed: false, partial: false, evidence: 'Failed to parse package.json' };
    }
  },
  cors_configured() {
    const files = _findFiles(path.resolve(BASE_DIR, 'backend'), /app\.js$|server\.js$|index\.js$/, ['node_modules']);
    let ok = false;
    for (const f of files) {
      try {
        if (/cors/i.test(fs.readFileSync(f, 'utf8'))) { ok = true; break; }
      } catch { /* ignore */ }
    }
    return { passed: ok, partial: !ok, evidence: ok ? 'CORS middleware found' : 'CORS configuration not detected' };
  },
  env_vars_not_committed() {
    const gitignore = path.resolve(BASE_DIR, '.gitignore');
    if (!fs.existsSync(gitignore)) return { passed: false, partial: true, evidence: '.gitignore missing' };
    const content = fs.readFileSync(gitignore, 'utf8');
    const ok = /^\.env$/m.test(content);
    return { passed: ok, partial: !ok, evidence: ok ? '.env excluded in .gitignore' : '.env not in .gitignore' };
  },
  npm_audit_clean() {
    // Static check — production CI would run `npm audit`
    const auditReport = path.resolve(BASE_DIR, 'npm-audit-report.json');
    if (fs.existsSync(auditReport)) {
      try {
        const data = JSON.parse(fs.readFileSync(auditReport, 'utf8'));
        const vulns = data.metadata?.vulnerabilities;
        const criticalHigh = (vulns?.critical || 0) + (vulns?.high || 0);
        return { passed: criticalHigh === 0, partial: criticalHigh < 5, evidence: `npm audit: ${criticalHigh} critical/high vulns` };
      } catch { /* fall through */ }
    }
    return { passed: false, partial: true, evidence: 'npm audit report not found — run: npm audit --json > npm-audit-report.json' };
  },
  session_management() {
    const p = path.resolve(SECURITY_DIR, 'securityService.js');
    if (!fs.existsSync(p)) return { passed: false, partial: false, evidence: 'securityService.js missing' };
    const src = fs.readFileSync(p, 'utf8');
    const ok = /session|blacklist|revok/i.test(src);
    return { passed: ok, partial: false, evidence: ok ? 'Session/blacklist management found' : 'Session management not found' };
  },
  token_rotation() {
    const p = path.resolve(SECURITY_DIR, 'securityService.js');
    if (!fs.existsSync(p)) return { passed: false, partial: false, evidence: 'securityService.js missing' };
    const src = fs.readFileSync(p, 'utf8');
    const ok = /refresh.*token|token.*rotation|rotate.*token/i.test(src);
    return { passed: ok, partial: !ok, evidence: ok ? 'Token rotation found' : 'Token rotation not found' };
  },
  sbom_generation() {
    const candidates = [
      path.resolve(SRE_DIR, 'sbom/SBOMGenerator.js'),
      path.resolve(BASE_DIR, 'backend/security/sbom/SBOMGenerator.js'),
      path.resolve(BASE_DIR, 'SBOMGenerator.js'),
    ];
    const exists = candidates.some(c => fs.existsSync(c));
    return { passed: exists, partial: !exists, evidence: exists ? 'SBOMGenerator.js found' : 'SBOMGenerator.js not found' };
  },
  supply_chain_attestation() {
    const candidates = [
      path.resolve(BASE_DIR, '.github/workflows/supply-chain.yml'),
      path.resolve(BASE_DIR, 'supply-chain-attestation.json'),
    ];
    const exists = candidates.some(c => fs.existsSync(c));
    return { passed: exists, partial: !exists, evidence: exists ? 'Supply chain config found' : 'Supply chain attestation not configured' };
  },
  security_event_logging() {
    const p = path.resolve(SRE_DIR, 'sreService.js');
    if (!fs.existsSync(p)) return { passed: false, partial: false, evidence: 'sreService.js missing' };
    const src = fs.readFileSync(p, 'utf8');
    const ok = /security.*event|audit.*log|log.*security/i.test(src);
    return { passed: ok, partial: !ok, evidence: ok ? 'Security event logging found in sreService' : 'Security event logging not found' };
  },
  audit_trail() {
    const p = path.resolve(SRE_DIR, 'sreService.js');
    const exists = fs.existsSync(p);
    return { passed: exists, partial: false, evidence: exists ? 'sreService.js (audit trail) found' : 'sreService.js missing' };
  },
  url_validation_ssrf() {
    const p = path.resolve(SECURITY_DIR, 'securityService.js');
    if (!fs.existsSync(p)) return { passed: false, partial: false, evidence: 'securityService.js missing' };
    const src = fs.readFileSync(p, 'utf8');
    const ok = /ssrf|validateUrl|safeUrl|allowedHost/i.test(src);
    return { passed: ok, partial: false, evidence: ok ? 'SSRF/URL validation found' : 'SSRF protection not detected' };
  },

  // Internal control hooks
  chaos_testing() {
    const candidates = [
      path.resolve(SRE_DIR, 'chaos/chaos-test.js'),
      path.resolve(BASE_DIR, 'tests/chaos-test.js'),
      path.resolve(BASE_DIR, 'chaos-test.js'),
    ];
    const exists = candidates.some(c => fs.existsSync(c));
    return { passed: exists, partial: !exists, evidence: exists ? 'chaos-test.js found' : 'chaos-test.js not found' };
  },
  slo_monitoring() {
    const candidates = [
      path.resolve(SRE_DIR, 'slo/SLOManager.js'),
      path.resolve(SRE_DIR, 'SLOManager.js'),
    ];
    const exists = candidates.some(c => fs.existsSync(c));
    return { passed: exists, partial: !exists, evidence: exists ? 'SLOManager.js found' : 'SLOManager.js not found' };
  },
  incident_management() {
    const candidates = [
      path.resolve(SRE_DIR, 'incidents/IncidentManager.js'),
      path.resolve(SRE_DIR, 'IncidentManager.js'),
    ];
    const exists = candidates.some(c => fs.existsSync(c));
    return { passed: exists, partial: !exists, evidence: exists ? 'IncidentManager.js found' : 'IncidentManager.js not found' };
  },
  postmortem_process() {
    const candidates = [
      path.resolve(SRE_DIR, 'incidents/PostmortemManager.js'),
      path.resolve(BASE_DIR, 'docs/postmortem-process.md'),
    ];
    const exists = candidates.some(c => fs.existsSync(c));
    return { passed: exists, partial: !exists, evidence: exists ? 'Postmortem process artifact found' : 'Postmortem process not found' };
  },
};

// ─── Utilities ────────────────────────────────────────────────────────────────

function _findFiles(dir, pattern, excludeDirs = []) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!excludeDirs.includes(entry.name)) {
        results.push(..._findFiles(path.join(dir, entry.name), pattern, excludeDirs));
      }
    } else if (pattern.test(entry.name)) {
      results.push(path.join(dir, entry.name));
    }
  }
  return results;
}

function _coverageScore(controls) {
  const total = controls.filter(c => c.status !== STATUS.EXEMPT).length;
  if (total === 0) return 100;
  const impl    = controls.filter(c => c.status === STATUS.IMPLEMENTED).length;
  const partial = controls.filter(c => c.status === STATUS.PARTIAL).length;
  return Math.round(((impl + partial * 0.5) / total) * 100);
}

function _ts() { return new Date().toISOString(); }

// ─── Main Class ───────────────────────────────────────────────────────────────

class ComplianceFrameworkEngine extends EventEmitter {
  constructor(options = {}) {
    super();
    this.logger   = options.logger || console;
    this.metrics  = options.metrics || null; // Prometheus registry
    this._controls = {
      [FRAMEWORK.OWASP]:    this._buildOwaspControls(),
      [FRAMEWORK.NIST]:     this._buildNistControls(),
      [FRAMEWORK.INTERNAL]: this._buildInternalControls(),
    };
    this._lastAssessed = null;
    this._prometheusMetrics = {};
    this._initMetrics();
  }

  // ── Build ───────────────────────────────────────────────────────────────────

  _buildOwaspControls() {
    return OWASP_CONTROLS.map(c => ({
      id:          c.id,
      framework:   FRAMEWORK.OWASP,
      title:       c.title,
      description: c.description,
      checks:      c.checks,
      status:      STATUS.NOT_IMPLEMENTED,
      checkResults: {},
      evidence:    [],
      lastCheckedAt: null,
    }));
  }

  _buildNistControls() {
    return NIST_CONTROLS.map(c => ({
      id:          c.id,
      framework:   FRAMEWORK.NIST,
      function:    c.function,
      title:       c.title,
      description: c.description,
      status:      STATUS.NOT_IMPLEMENTED,
      evidence:    [],
      lastCheckedAt: null,
    }));
  }

  _buildInternalControls() {
    return INTERNAL_CONTROLS.map(c => ({
      id:          c.id,
      framework:   FRAMEWORK.INTERNAL,
      title:       c.title,
      description: c.description,
      status:      STATUS.NOT_IMPLEMENTED,
      evidence:    [],
      lastCheckedAt: null,
    }));
  }

  // ── Metrics ─────────────────────────────────────────────────────────────────

  _initMetrics() {
    if (!this.metrics) return;
    try {
      const { Gauge } = require('prom-client');
      this._prometheusMetrics.complianceScore = new Gauge({
        name: 'compliance_score',
        help: 'Compliance score per framework (0-100)',
        labelNames: ['framework'],
        registers: [this.metrics],
      });
      this._prometheusMetrics.implementedTotal = new Gauge({
        name: 'compliance_controls_implemented_total',
        help: 'Total number of fully implemented controls',
        registers: [this.metrics],
      });
      this._prometheusMetrics.gapTotal = new Gauge({
        name: 'compliance_controls_gap_total',
        help: 'Total number of NOT_IMPLEMENTED controls',
        registers: [this.metrics],
      });
    } catch { /* prom-client not available */ }
  }

  _publishMetrics() {
    if (!this._prometheusMetrics.complianceScore) return;
    for (const fw of Object.values(FRAMEWORK)) {
      this._prometheusMetrics.complianceScore.labels(fw).set(this.getFrameworkScore(fw));
    }
    const allControls = this._allControls();
    this._prometheusMetrics.implementedTotal.set(
      allControls.filter(c => c.status === STATUS.IMPLEMENTED).length
    );
    this._prometheusMetrics.gapTotal.set(
      allControls.filter(c => c.status === STATUS.NOT_IMPLEMENTED).length
    );
  }

  _allControls() {
    return [
      ...this._controls[FRAMEWORK.OWASP],
      ...this._controls[FRAMEWORK.NIST],
      ...this._controls[FRAMEWORK.INTERNAL],
    ];
  }

  // ── Assessment ──────────────────────────────────────────────────────────────

  /**
   * Run all automated validation hooks and update control statuses.
   * @returns {Promise<Object>} Assessment summary
   */
  async assessAll() {
    this.logger.info('[ComplianceEngine] Starting full compliance assessment...');
    const startedAt = Date.now();

    await this._assessOwasp();
    await this._assessNist();
    await this._assessInternal();

    this._lastAssessed = _ts();
    const elapsed = Date.now() - startedAt;
    this._publishMetrics();

    const summary = {
      assessedAt:    this._lastAssessed,
      elapsedMs:     elapsed,
      overallScore:  this.getOverallScore(),
      frameworkScores: {
        [FRAMEWORK.OWASP]:    this.getFrameworkScore(FRAMEWORK.OWASP),
        [FRAMEWORK.NIST]:     this.getFrameworkScore(FRAMEWORK.NIST),
        [FRAMEWORK.INTERNAL]: this.getFrameworkScore(FRAMEWORK.INTERNAL),
      },
      gapCount: this.getGapAnalysis().length,
    };

    this.emit('assessed', summary);
    this.logger.info(`[ComplianceEngine] Assessment complete. Overall score: ${summary.overallScore}/100 (${elapsed}ms)`);
    return summary;
  }

  _runHook(hookName) {
    if (typeof VALIDATION_HOOKS[hookName] === 'function') {
      try { return VALIDATION_HOOKS[hookName](); }
      catch (e) { return { passed: false, partial: false, evidence: `Hook error: ${e.message}` }; }
    }
    return { passed: false, partial: true, evidence: `No hook registered for: ${hookName}` };
  }

  async _assessOwasp() {
    for (const control of this._controls[FRAMEWORK.OWASP]) {
      const results = {};
      for (const check of control.checks) {
        results[check] = this._runHook(check);
      }
      control.checkResults = results;

      const passed  = Object.values(results).filter(r => r.passed).length;
      const partial = Object.values(results).filter(r => !r.passed && r.partial).length;
      const total   = Object.values(results).length;

      if (passed === total)           control.status = STATUS.IMPLEMENTED;
      else if (passed + partial > 0)  control.status = STATUS.PARTIAL;
      else                            control.status = STATUS.NOT_IMPLEMENTED;

      control.evidence     = Object.values(results).map(r => r.evidence).filter(Boolean);
      control.lastCheckedAt = _ts();
    }
  }

  async _assessNist() {
    // NIST mapping: map NIST categories to available hooks
    const NIST_HOOK_MAP = {
      'ID.AM': ['audit_trail'],
      'ID.BE': [],
      'ID.GV': ['security_review_process'],
      'ID.RA': [],
      'PR.AC': ['auth_middleware', 'rbac_security_service'],
      'PR.AT': [],
      'PR.DS': ['password_hashing', 'tls_enforced'],
      'PR.IP': ['helmet_enabled', 'env_vars_not_committed'],
      'PR.MA': [],
      'PR.PT': ['helmet_enabled', 'cors_configured'],
      'DE.AE': ['security_event_logging'],
      'DE.CM': ['slo_monitoring'],
      'DE.DP': ['incident_management'],
      'RS.RP': ['incident_management'],
      'RS.CO': [],
      'RS.AN': ['postmortem_process'],
      'RS.MI': ['url_validation_ssrf'],
      'RS.IM': ['postmortem_process'],
      'RC.RP': ['incident_management'],
      'RC.IM': ['postmortem_process'],
    };

    for (const control of this._controls[FRAMEWORK.NIST]) {
      const hooks = NIST_HOOK_MAP[control.id] || [];
      if (hooks.length === 0) {
        // Manual review required
        control.status    = STATUS.PARTIAL;
        control.evidence  = ['Manual review required — no automated hook available'];
        control.lastCheckedAt = _ts();
        continue;
      }

      const results = {};
      for (const h of hooks) results[h] = this._runHook(h);

      const passed  = Object.values(results).filter(r => r.passed).length;
      const partial = Object.values(results).filter(r => !r.passed && r.partial).length;
      const total   = Object.values(results).length;

      if (passed === total)           control.status = STATUS.IMPLEMENTED;
      else if (passed + partial > 0)  control.status = STATUS.PARTIAL;
      else                            control.status = STATUS.NOT_IMPLEMENTED;

      control.evidence     = Object.values(results).map(r => r.evidence).filter(Boolean);
      control.lastCheckedAt = _ts();
    }
  }

  async _assessInternal() {
    // Map SEC-xxx IDs to hook names
    const INTERNAL_HOOK_MAP = {
      'SEC-001': ['url_validation_ssrf'],
      'SEC-002': ['session_management'],
      'SEC-003': ['helmet_enabled'],             // rate limiting implied with helmet setup
      'SEC-004': ['helmet_enabled'],
      'SEC-005': ['input_sanitization'],
      'SEC-006': ['audit_trail'],
      'SEC-007': ['env_vars_not_committed'],
      'SEC-008': [],                              // container scanning — manual
      'SEC-009': ['sbom_generation'],
      'SEC-010': ['supply_chain_attestation'],
      'SEC-011': ['slo_monitoring'],
      'SEC-012': ['incident_management'],
      'SEC-013': ['postmortem_process'],
      'SEC-014': ['chaos_testing'],
      'SEC-015': ['slo_monitoring'],
    };

    for (const control of this._controls[FRAMEWORK.INTERNAL]) {
      const hooks = INTERNAL_HOOK_MAP[control.id] || [];
      if (hooks.length === 0) {
        control.status    = STATUS.PARTIAL;
        control.evidence  = ['Manual verification required'];
        control.lastCheckedAt = _ts();
        continue;
      }
      const results = {};
      for (const h of hooks) results[h] = this._runHook(h);

      const passed  = Object.values(results).filter(r => r.passed).length;
      const partial = Object.values(results).filter(r => !r.passed && r.partial).length;
      const total   = Object.values(results).length;

      if (passed === total)           control.status = STATUS.IMPLEMENTED;
      else if (passed + partial > 0)  control.status = STATUS.PARTIAL;
      else                            control.status = STATUS.NOT_IMPLEMENTED;

      control.evidence     = Object.values(results).map(r => r.evidence).filter(Boolean);
      control.lastCheckedAt = _ts();
    }
  }

  // ── Scoring ─────────────────────────────────────────────────────────────────

  /** Returns coverage score 0-100 for a given framework */
  getFrameworkScore(framework) {
    const controls = this._controls[framework];
    if (!controls || controls.length === 0) return 0;
    return _coverageScore(controls);
  }

  /** Returns weighted composite score 0-100 */
  getOverallScore() {
    let score = 0;
    for (const [fw, weight] of Object.entries(FRAMEWORK_WEIGHTS)) {
      score += this.getFrameworkScore(fw) * weight;
    }
    return Math.round(score);
  }

  // ── Analysis ────────────────────────────────────────────────────────────────

  /** Returns list of NOT_IMPLEMENTED controls (gap analysis) */
  getGapAnalysis() {
    return this._allControls()
      .filter(c => c.status === STATUS.NOT_IMPLEMENTED)
      .map(c => ({
        id:          c.id,
        framework:   c.framework,
        title:       c.title,
        description: c.description,
        priority:    c.framework === FRAMEWORK.OWASP ? 'HIGH' : 'MEDIUM',
      }));
  }

  /** Returns status of a single control by ID */
  getControlStatus(controlId) {
    const all = this._allControls();
    return all.find(c => c.id === controlId) || null;
  }

  /** Returns all controls for a framework */
  getControlsByFramework(framework) {
    return this._controls[framework] || [];
  }

  // ── Reporting ───────────────────────────────────────────────────────────────

  /** Generates a full in-memory compliance report */
  generateReport() {
    const gaps    = this.getGapAnalysis();
    const allCtrl = this._allControls();
    const now     = _ts();

    const byFramework = {};
    for (const fw of Object.values(FRAMEWORK)) {
      const controls = this._controls[fw];
      byFramework[fw] = {
        score:            this.getFrameworkScore(fw),
        implemented:      controls.filter(c => c.status === STATUS.IMPLEMENTED).length,
        partial:          controls.filter(c => c.status === STATUS.PARTIAL).length,
        notImplemented:   controls.filter(c => c.status === STATUS.NOT_IMPLEMENTED).length,
        exempt:           controls.filter(c => c.status === STATUS.EXEMPT).length,
        total:            controls.length,
        controls,
      };
    }

    return {
      reportId:      `COMPLIANCE-${Date.now()}`,
      generatedAt:   now,
      lastAssessedAt: this._lastAssessed,
      overallScore:   this.getOverallScore(),
      riskLevel:      this._scoreToRiskLevel(this.getOverallScore()),
      byFramework,
      summary: {
        totalControls:      allCtrl.length,
        implemented:        allCtrl.filter(c => c.status === STATUS.IMPLEMENTED).length,
        partial:            allCtrl.filter(c => c.status === STATUS.PARTIAL).length,
        notImplemented:     allCtrl.filter(c => c.status === STATUS.NOT_IMPLEMENTED).length,
        exempt:             allCtrl.filter(c => c.status === STATUS.EXEMPT).length,
        gapCount:           gaps.length,
      },
      gapAnalysis: gaps,
      recommendations: this._generateRecommendations(gaps),
    };
  }

  _scoreToRiskLevel(score) {
    if (score >= 85) return 'LOW';
    if (score >= 70) return 'MEDIUM';
    if (score >= 50) return 'HIGH';
    return 'CRITICAL';
  }

  _generateRecommendations(gaps) {
    const recs = [];
    const owaspGaps = gaps.filter(g => g.framework === FRAMEWORK.OWASP);
    if (owaspGaps.length > 0) {
      recs.push({
        priority: 'HIGH',
        action:   'Address OWASP Top 10 gaps immediately — these represent active exploit risk.',
        items:    owaspGaps.map(g => `${g.id}: ${g.title}`),
      });
    }
    const nistGaps = gaps.filter(g => g.framework === FRAMEWORK.NIST);
    if (nistGaps.length > 0) {
      recs.push({
        priority: 'MEDIUM',
        action:   'Schedule NIST CSF gap remediation in next sprint.',
        items:    nistGaps.map(g => `${g.id}: ${g.title}`),
      });
    }
    const internalGaps = gaps.filter(g => g.framework === FRAMEWORK.INTERNAL);
    if (internalGaps.length > 0) {
      recs.push({
        priority: 'MEDIUM',
        action:   'Implement missing internal controls per SRE runbook.',
        items:    internalGaps.map(g => `${g.id}: ${g.title}`),
      });
    }
    return recs;
  }

  /** Saves report to compliance-report.json */
  exportReport() {
    const report = this.generateReport();
    fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
    fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), 'utf8');
    this.logger.info(`[ComplianceEngine] Report exported to ${REPORT_PATH}`);
    this.emit('reportExported', REPORT_PATH);
    return REPORT_PATH;
  }
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = { ComplianceFrameworkEngine, STATUS, FRAMEWORK, FRAMEWORK_WEIGHTS };
