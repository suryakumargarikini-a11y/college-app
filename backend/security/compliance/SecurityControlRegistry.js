'use strict';

/**
 * SecurityControlRegistry.js
 * SITAM Smart ERP — Compliance & Risk Management Layer
 *
 * Maintains the canonical registry of all security controls across frameworks.
 * Auto-populates from ComplianceFrameworkEngine on init, provides audit-ready
 * JSON export, and supports rich querying by framework / category / status.
 */

const fs   = require('fs');
const path = require('path');
const EventEmitter = require('events');

const REGISTRY_PATH = path.resolve(__dirname, 'control-registry.json');

// ─── Valid field enumerations ─────────────────────────────────────────────────

const VALID_STATUSES = new Set([
  'IMPLEMENTED', 'PARTIAL', 'NOT_IMPLEMENTED', 'EXEMPT',
]);

const VALID_FRAMEWORKS = new Set([
  'OWASP_TOP10_2021', 'NIST_CSF', 'INTERNAL_CONTROLS',
]);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function _ts() { return new Date().toISOString(); }
function _id() { return `CTL-${Date.now()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`; }

/**
 * Validate a control object. Throws on missing required fields.
 */
function _validate(control) {
  const required = ['id', 'name', 'description', 'framework', 'status'];
  for (const f of required) {
    if (!control[f]) throw new Error(`Control missing required field: ${f}`);
  }
  if (!VALID_STATUSES.has(control.status)) {
    throw new Error(`Invalid status '${control.status}'. Must be one of: ${[...VALID_STATUSES].join(', ')}`);
  }
  if (!VALID_FRAMEWORKS.has(control.framework)) {
    throw new Error(`Invalid framework '${control.framework}'. Must be one of: ${[...VALID_FRAMEWORKS].join(', ')}`);
  }
}

// ─── Main Class ───────────────────────────────────────────────────────────────

class SecurityControlRegistry extends EventEmitter {
  /**
   * @param {Object} options
   * @param {Object} [options.engine]  - ComplianceFrameworkEngine instance (optional)
   * @param {Object} [options.logger]  - Logger (defaults to console)
   * @param {boolean} [options.persist] - Auto-persist on every mutation (default: true)
   */
  constructor(options = {}) {
    super();
    this.logger    = options.logger  || console;
    this._engine   = options.engine  || null;
    this._persist  = options.persist !== false;

    /** @type {Map<string, Object>} id → control record */
    this._registry = new Map();

    if (this._engine) {
      this._populateFromEngine();
    }
  }

  // ── Population ──────────────────────────────────────────────────────────────

  /**
   * Auto-populate registry from a ComplianceFrameworkEngine instance.
   * Converts engine control objects to the registry schema.
   */
  _populateFromEngine() {
    const { FRAMEWORK } = require('./ComplianceFrameworkEngine');
    for (const fw of Object.values(FRAMEWORK)) {
      const controls = this._engine.getControlsByFramework
        ? this._engine.getControlsByFramework(fw)
        : (this._engine._controls && this._engine._controls[fw]) || [];

      for (const c of controls) {
        const record = this._engineControlToRecord(c, fw);
        this._registry.set(record.id, record);
      }
    }
    this.logger.info(`[SecurityControlRegistry] Populated ${this._registry.size} controls from engine.`);
  }

  _engineControlToRecord(c, framework) {
    return {
      id:                  c.id,
      name:                c.title || c.id,
      description:         c.description || '',
      framework:           framework,
      category:            c.function || c.category || _deriveCategory(framework, c.id),
      status:              c.status || 'NOT_IMPLEMENTED',
      implementationNotes: c.implementationNotes || '',
      verificationMethod:  c.checks
        ? `Automated hooks: ${c.checks.join(', ')}`
        : 'Manual review',
      lastValidatedAt:     c.lastCheckedAt || null,
      validatedBy:         c.validatedBy || 'ComplianceFrameworkEngine (automated)',
      evidence:            c.evidence || [],
      checkResults:        c.checkResults || {},
      registeredAt:        _ts(),
      updatedAt:           _ts(),
    };
  }

  // ── CRUD ────────────────────────────────────────────────────────────────────

  /**
   * Register a new control or upsert by id.
   * @param {Object} control
   * @returns {Object} The stored control record
   */
  registerControl(control) {
    if (!control.id) control.id = _id();
    _validate(control);

    const existing = this._registry.get(control.id);
    const record = {
      id:                  control.id,
      name:                control.name,
      description:         control.description,
      framework:           control.framework,
      category:            control.category || _deriveCategory(control.framework, control.id),
      status:              control.status,
      implementationNotes: control.implementationNotes || '',
      verificationMethod:  control.verificationMethod || 'Manual review',
      lastValidatedAt:     control.lastValidatedAt || null,
      validatedBy:         control.validatedBy || 'manual',
      evidence:            control.evidence || [],
      checkResults:        control.checkResults || {},
      registeredAt:        existing ? existing.registeredAt : _ts(),
      updatedAt:           _ts(),
    };

    this._registry.set(record.id, record);
    this.emit('controlRegistered', record);
    this.logger.info(`[SecurityControlRegistry] Registered control: ${record.id} (${record.name})`);

    if (this._persist) this._save();
    return record;
  }

  /**
   * Update status and evidence for a control.
   * @param {string} id
   * @param {string} status
   * @param {string|string[]} evidence
   */
  updateStatus(id, status, evidence = []) {
    const ctrl = this._registry.get(id);
    if (!ctrl) throw new Error(`Control not found: ${id}`);
    if (!VALID_STATUSES.has(status)) throw new Error(`Invalid status: ${status}`);

    ctrl.status    = status;
    ctrl.evidence  = Array.isArray(evidence) ? evidence : [evidence];
    ctrl.updatedAt = _ts();

    this.emit('statusUpdated', { id, status, evidence });
    this.logger.info(`[SecurityControlRegistry] Updated ${id} → ${status}`);

    if (this._persist) this._save();
    return ctrl;
  }

  /**
   * Re-validate a single control using its engine hook (if available).
   * Falls back to returning current status if no engine is attached.
   */
  async validateControl(id) {
    const ctrl = this._registry.get(id);
    if (!ctrl) throw new Error(`Control not found: ${id}`);

    // If engine available, ask it to re-check
    if (this._engine && typeof this._engine.getControlStatus === 'function') {
      const fresh = this._engine.getControlStatus(id);
      if (fresh) {
        ctrl.status          = fresh.status;
        ctrl.evidence        = fresh.evidence || ctrl.evidence;
        ctrl.lastValidatedAt = _ts();
        ctrl.validatedBy     = 'ComplianceFrameworkEngine (automated)';
        ctrl.updatedAt       = _ts();
        if (this._persist) this._save();
      }
    } else {
      // Manual re-validation placeholder
      ctrl.lastValidatedAt = _ts();
      ctrl.validatedBy     = 'manual';
      ctrl.updatedAt       = _ts();
      if (this._persist) this._save();
    }

    this.emit('controlValidated', ctrl);
    return ctrl;
  }

  // ── Querying ────────────────────────────────────────────────────────────────

  /** Returns all controls as an array */
  getAllControls() {
    return [...this._registry.values()];
  }

  /**
   * Filter by framework.
   * @param {string} framework  e.g. 'OWASP_TOP10_2021'
   */
  getByFramework(framework) {
    return this.getAllControls().filter(c => c.framework === framework);
  }

  /**
   * Filter by category (NIST function or custom category string).
   * @param {string} category
   */
  getByCategory(category) {
    return this.getAllControls().filter(c => c.category === category);
  }

  /**
   * Filter by status.
   * @param {string} status  e.g. 'NOT_IMPLEMENTED'
   */
  getByStatus(status) {
    return this.getAllControls().filter(c => c.status === status);
  }

  /**
   * Filter controls not validated since the given date.
   * @param {Date|string} since
   */
  getStaleControls(since) {
    const cutoff = new Date(since).getTime();
    return this.getAllControls().filter(c => {
      if (!c.lastValidatedAt) return true;
      return new Date(c.lastValidatedAt).getTime() < cutoff;
    });
  }

  /**
   * Returns controls matching all provided criteria.
   * @param {Object} query  { framework?, category?, status?, staleSince? }
   */
  query(query = {}) {
    let results = this.getAllControls();
    if (query.framework)   results = results.filter(c => c.framework === query.framework);
    if (query.category)    results = results.filter(c => c.category  === query.category);
    if (query.status)      results = results.filter(c => c.status    === query.status);
    if (query.staleSince) {
      const cutoff = new Date(query.staleSince).getTime();
      results = results.filter(c => !c.lastValidatedAt || new Date(c.lastValidatedAt).getTime() < cutoff);
    }
    return results;
  }

  // ── Statistics ──────────────────────────────────────────────────────────────

  /**
   * Returns implementation rate per framework and overall.
   */
  getImplementationRate() {
    const all = this.getAllControls();
    const calc = arr => {
      const total     = arr.filter(c => c.status !== 'EXEMPT').length;
      if (total === 0) return { rate: 100, total: 0, implemented: 0, partial: 0, notImplemented: 0 };
      const impl      = arr.filter(c => c.status === 'IMPLEMENTED').length;
      const partial   = arr.filter(c => c.status === 'PARTIAL').length;
      const notImpl   = arr.filter(c => c.status === 'NOT_IMPLEMENTED').length;
      return {
        rate: Math.round(((impl + partial * 0.5) / total) * 100),
        total, implemented: impl, partial, notImplemented: notImpl,
      };
    };

    const byFramework = {};
    for (const fw of VALID_FRAMEWORKS) {
      byFramework[fw] = calc(all.filter(c => c.framework === fw));
    }

    return { overall: calc(all), byFramework };
  }

  // ── Audit Export ────────────────────────────────────────────────────────────

  /**
   * Generates a structured audit-ready export object.
   */
  exportForAudit() {
    const controls = this.getAllControls();
    const rate     = this.getImplementationRate();
    return {
      exportId:       `REGISTRY-AUDIT-${Date.now()}`,
      exportedAt:     _ts(),
      totalControls:  controls.length,
      implementationRate: rate,
      controls: controls.map(c => ({
        id:                  c.id,
        name:                c.name,
        framework:           c.framework,
        category:            c.category,
        status:              c.status,
        implementationNotes: c.implementationNotes,
        verificationMethod:  c.verificationMethod,
        lastValidatedAt:     c.lastValidatedAt,
        validatedBy:         c.validatedBy,
        evidence:            c.evidence,
      })),
    };
  }

  /**
   * Saves audit export JSON to control-registry.json.
   * @returns {string} Path to saved file
   */
  saveAuditExport() {
    const data = this.exportForAudit();
    fs.mkdirSync(path.dirname(REGISTRY_PATH), { recursive: true });
    fs.writeFileSync(REGISTRY_PATH, JSON.stringify(data, null, 2), 'utf8');
    this.logger.info(`[SecurityControlRegistry] Audit export saved to ${REGISTRY_PATH}`);
    this.emit('auditExported', REGISTRY_PATH);
    return REGISTRY_PATH;
  }

  // ── Internal Persistence ────────────────────────────────────────────────────

  _save() {
    try {
      fs.mkdirSync(path.dirname(REGISTRY_PATH), { recursive: true });
      fs.writeFileSync(REGISTRY_PATH, JSON.stringify(this.exportForAudit(), null, 2), 'utf8');
    } catch (e) {
      this.logger.warn(`[SecurityControlRegistry] Failed to auto-save: ${e.message}`);
    }
  }

  /** Load a previously saved registry JSON back into memory */
  loadFromFile(filePath = REGISTRY_PATH) {
    if (!fs.existsSync(filePath)) {
      this.logger.warn(`[SecurityControlRegistry] File not found: ${filePath}`);
      return 0;
    }
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    let count  = 0;
    for (const c of (data.controls || [])) {
      this._registry.set(c.id, { ...c, updatedAt: c.updatedAt || _ts() });
      count++;
    }
    this.logger.info(`[SecurityControlRegistry] Loaded ${count} controls from ${filePath}`);
    return count;
  }
}

// ─── Helpers (module-level) ───────────────────────────────────────────────────

function _deriveCategory(framework, id) {
  if (framework === 'OWASP_TOP10_2021') return `OWASP:${id}`;
  if (framework === 'NIST_CSF') {
    const fn = id.split('.')[0];
    const map = { ID: 'IDENTIFY', PR: 'PROTECT', DE: 'DETECT', RS: 'RESPOND', RC: 'RECOVER' };
    return map[fn] || fn;
  }
  return 'INTERNAL';
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = { SecurityControlRegistry, VALID_STATUSES, VALID_FRAMEWORKS };
