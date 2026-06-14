'use strict';

/**
 * SecretGovernanceManager.js
 * SITAM Smart ERP — DevSecOps Secret Lifecycle Management
 *
 * Tracks age, health scoring, rotation schedules, and revocation states for all
 * platform credentials (JWT secrets, DB/Redis passwords, API keys). Emits
 * Prometheus indicators for pending rotations.
 */

const fs = require('fs');
const path = require('path');
const logger = require('../../services/logger');

const CREDENTIAL_TYPES = Object.freeze({
  JWT_SECRET: 'JWT_SECRET',
  DB_PASSWORD: 'DB_PASSWORD',
  REDIS_PASSWORD: 'REDIS_PASSWORD',
  FIREBASE_KEY: 'FIREBASE_KEY',
  API_KEY: 'API_KEY'
});

class SecretGovernanceManager {
  constructor(options = {}) {
    this.reportsDir = options.reportsDir || path.resolve(__dirname, '../../security-reports');
    this.metrics = options.metrics || null;
    this.registryPath = options.registryPath || path.resolve(__dirname, 'secrets-registry.json');
    this._loadOrCreateRegistry();
    this._initMetrics();
  }

  _initMetrics() {
    if (!this.metrics) return;
    try {
      const { Gauge } = require('prom-client');
      this.secretHealthScore = new Gauge({
        name: 'secret_health_score',
        help: 'Health score of a specific credential (0-100)',
        labelNames: ['secret_name'],
        registers: [this.metrics]
      });
      this.secretRotationPending = new Gauge({
        name: 'secret_rotation_pending',
        help: '1 if secret rotation is pending/overdue, 0 otherwise',
        labelNames: ['secret_name'],
        registers: [this.metrics]
      });
    } catch (err) {
      logger.warn(`[SecretGovernance] Failed to initialize metrics: ${err.message}`);
    }
  }

  _loadOrCreateRegistry() {
    if (fs.existsSync(this.registryPath)) {
      try {
        this.registry = JSON.parse(fs.readFileSync(this.registryPath, 'utf8'));
        return;
      } catch (err) {
        logger.warn(`[SecretGovernance] Failed to parse registry, recreating: ${err.message}`);
      }
    }

    const defaultTTL = 90 * 24 * 60 * 60 * 1000;
    const now = new Date();

    this.registry = {
      secrets: [
        {
          name: 'JWT_SECRET',
          type: CREDENTIAL_TYPES.JWT_SECRET,
          createdAt: now.toISOString(),
          expiresAt: new Date(now.getTime() + defaultTTL).toISOString(),
          lastRotated: now.toISOString(),
          ttlMs: defaultTTL,
          status: 'ACTIVE'
        },
        {
          name: 'DB_PASSWORD',
          type: CREDENTIAL_TYPES.DB_PASSWORD,
          createdAt: now.toISOString(),
          expiresAt: new Date(now.getTime() + defaultTTL).toISOString(),
          lastRotated: now.toISOString(),
          ttlMs: defaultTTL,
          status: 'ACTIVE'
        },
        {
          name: 'REDIS_PASSWORD',
          type: CREDENTIAL_TYPES.REDIS_PASSWORD,
          createdAt: now.toISOString(),
          expiresAt: new Date(now.getTime() + defaultTTL).toISOString(),
          lastRotated: now.toISOString(),
          ttlMs: defaultTTL,
          status: 'ACTIVE'
        },
        {
          name: 'FIREBASE_KEY',
          type: CREDENTIAL_TYPES.FIREBASE_KEY,
          createdAt: now.toISOString(),
          expiresAt: new Date(now.getTime() + defaultTTL).toISOString(),
          lastRotated: now.toISOString(),
          ttlMs: defaultTTL,
          status: 'ACTIVE'
        },
        {
          name: 'API_KEY',
          type: CREDENTIAL_TYPES.API_KEY,
          createdAt: now.toISOString(),
          expiresAt: new Date(now.getTime() + defaultTTL).toISOString(),
          lastRotated: now.toISOString(),
          ttlMs: defaultTTL,
          status: 'ACTIVE'
        }
      ]
    };
    this._saveRegistry();
  }

  _saveRegistry() {
    fs.mkdirSync(path.dirname(this.registryPath), { recursive: true });
    fs.writeFileSync(this.registryPath, JSON.stringify(this.registry, null, 2), 'utf8');
  }

  assessSecrets() {
    logger.info('[SecretGovernance] Assessing secret health and lifecycles...');
    const now = Date.now();
    const results = [];

    for (const secret of this.registry.secrets) {
      const created = new Date(secret.createdAt).getTime();
      const expires = new Date(secret.expiresAt).getTime();
      const ageMs = now - created;
      const totalLifetime = expires - created;

      let ratio = ageMs / totalLifetime;
      if (ratio > 1) ratio = 1;
      if (ratio < 0) ratio = 0;

      let healthScore = Math.max(0, Math.round((1 - ratio) * 100));
      if (secret.status === 'REVOKED') {
        healthScore = 0;
      }

      const rotationRequired = ratio >= 0.75;
      
      if (ratio >= 1.0) {
        logger.error(`[SecretGovernance] CREDENTIAL EXPIRED: Secret ${secret.name} is past its rotation date!`);
      } else if (ratio >= 0.90) {
        logger.warn(`[SecretGovernance] CRITICAL ROTATION WINDOW: Secret ${secret.name} is at ${Math.round(ratio * 100)}% of TTL!`);
      } else if (ratio >= 0.75) {
        logger.info(`[SecretGovernance] ROTATION WINDOW OPEN: Secret ${secret.name} is at ${Math.round(ratio * 100)}% of TTL.`);
      }

      if (this.secretHealthScore) {
        this.secretHealthScore.labels(secret.name).set(healthScore);
      }
      if (this.secretRotationPending) {
        this.secretRotationPending.labels(secret.name).set(rotationRequired ? 1 : 0);
      }

      results.push({
        name: secret.name,
        type: secret.type,
        healthScore,
        ageDays: Math.floor(ageMs / (24 * 60 * 60 * 1000)),
        daysRemaining: Math.max(0, Math.floor((expires - now) / (24 * 60 * 60 * 1000))),
        rotationRequired,
        status: secret.status
      });
    }

    return results;
  }

  rotateSecret(name) {
    logger.info(`[SecretGovernance] Rotating secret: ${name}`);
    const secret = this.registry.secrets.find(s => s.name === name);
    if (!secret) {
      throw new Error(`Secret not found in registry: ${name}`);
    }

    const now = new Date();
    secret.lastRotated = now.toISOString();
    secret.createdAt = now.toISOString();
    secret.expiresAt = new Date(now.getTime() + secret.ttlMs).toISOString();
    secret.status = 'ACTIVE';

    this._saveRegistry();
    logger.info(`[SecretGovernance] Secret ${name} successfully rotated. New expiry: ${secret.expiresAt}`);
    return secret;
  }

  revokeSecret(name) {
    logger.error(`[SecretGovernance] EMERGENCY REVOCATION INITIATED FOR: ${name}`);
    const secret = this.registry.secrets.find(s => s.name === name);
    if (!secret) {
      throw new Error(`Secret not found in registry: ${name}`);
    }

    secret.status = 'REVOKED';
    this._saveRegistry();
    return secret;
  }
  /** Scheduler alias — calls assessSecrets() */
  assessHealth() { return this.assessSecrets(); }
}

module.exports = SecretGovernanceManager;
