'use strict';

/**
 * AlertRouter.js
 * SITAM Smart ERP — Intelligent Alert Router
 *
 * Routes alerts to on-call teams, supports deduplication within windows,
 * controls fatigue limits (burst threshold suppression), and auto-creates SRE incidents
 * for critical P1/P2 alerts.
 *
 * AlertEscalationRules are injected by ObservabilityScheduler and are ACTIVELY
 * consumed by routeAlert() to resolve team ownership and log escalation stages.
 */

const logger = require('../../services/logger');

const SEVERITIES = Object.freeze({
  P1: 'P1',
  P2: 'P2',
  P3: 'P3',
  P4: 'P4'
});

// Default team mapping used when no escalationRules are injected
const DEFAULT_TEAM_MAP = {
  'db_error':         'database-team',
  'redis_error':      'infra-team',
  'scraping_failure': 'scraper-team',
  'network_timeout':  'network-team',
  'api_latency':      'backend-team',
  'auth_failure':     'security-team'
};

class AlertRouter {
  constructor(options = {}) {
    this.dedupWindowMs = options.dedupWindowMs || 10 * 60 * 1000;
    this.fatigueLimit = options.fatigueLimit || 3;
    this.fatigueWindowMs = 60 * 60 * 1000;
    this._recentAlerts = new Map();
    this._alertsHistory = [];
    this.incidentManager = options.incidentManager || null;
    // Populated by ObservabilityScheduler after construction
    this.escalationRules = null;
  }

  routeAlert(alert) {
    const now = Date.now();
    const { service, type, severity, message, description } = alert;

    const dedupKey = `${service}:${type}:${severity}`;
    const lastSeen = this._recentAlerts.get(dedupKey);
    if (lastSeen && (now - lastSeen) < this.dedupWindowMs) {
      logger.info(`[AlertRouter] Deduplicated alert: ${dedupKey}. Suppressing.`);
      return { status: 'DEDUPLICATED' };
    }

    this._recentAlerts.set(dedupKey, now);

    const recentHistory = this._alertsHistory.filter(h => (now - h.timestamp) < this.fatigueWindowMs && h.severity === severity);
    if (recentHistory.length >= this.fatigueLimit) {
      logger.warn(`[AlertRouter] Fatigue protection active for severity ${severity}. Suppressing alert.`);
      return { status: 'FATIGUED' };
    }

    this._alertsHistory.push({ timestamp: now, severity });

    // ── Resolve team from injected escalation rules (ownershipMatrix) ──────────
    const { team, onCall } = this._mapToTeam(type);
    logger.error(`[AlertRouter] [${severity}] Routed alert for ${service}/${type} to team: ${team}. On-call: ${onCall}. Message: ${message}`);

    // ── Log escalation stages from injected AlertEscalationRules ─────────────
    // This is the only place escalationRules is actively consumed at runtime.
    if (this.escalationRules && this.escalationRules.escalationRules) {
      const rule = this.escalationRules.escalationRules.find(r => r.severity === severity);
      if (rule) {
        for (const stage of rule.stages) {
          const delayLabel = stage.timeoutMs === 0 ? 'immediate' : `+${stage.timeoutMs / 60000}min`;
          logger.info(`[AlertRouter] Escalation stage [${delayLabel}]: notify ${stage.notify} for ${dedupKey}`);
        }
      }
    }

    if ((severity === SEVERITIES.P1 || severity === SEVERITIES.P2) && this.incidentManager) {
      try {
        const title = `Auto Incident: [${severity}] ${message}`;
        this.incidentManager.createIncident(severity, title, `Alert: ${description || message}`);
      } catch (err) {
        logger.error(`[AlertRouter] Failed to auto-create incident: ${err.message}`);
      }
    }

    return { status: 'ROUTED', team };
  }

  /**
   * Resolve team and on-call contact for a given alert type.
   * Reads from this.escalationRules.ownershipMatrix when injected by the scheduler;
   * falls back to the hardcoded DEFAULT_TEAM_MAP otherwise.
   */
  _mapToTeam(type) {
    const domainMap = {
      'db_error':         'database',
      'redis_error':      'redis',
      'scraping_failure': 'scraper',
      'network_timeout':  'api',
      'api_latency':      'api',
      'auth_failure':     'api'
    };

    if (this.escalationRules && this.escalationRules.ownershipMatrix) {
      const domain = domainMap[type] || 'api';
      const entry  = this.escalationRules.ownershipMatrix[domain];
      if (entry) {
        return { team: entry.team, onCall: entry.onCall };
      }
    }

    return { team: DEFAULT_TEAM_MAP[type] || 'ops-oncall', onCall: 'ops-oncall@sitams.org' };
  }
}

module.exports = AlertRouter;
