'use strict';

/**
 * AlertRouter.js
 * SITAM Smart ERP — Intelligent Alert Router
 *
 * Routes alerts to on-call teams, supports deduplication within windows,
 * controls fatigue limits (burst threshold suppression), and auto-creates SRE incidents
 * for critical P1/P2 alerts.
 */

const logger = require('../../services/logger');

const SEVERITIES = Object.freeze({
  P1: 'P1',
  P2: 'P2',
  P3: 'P3',
  P4: 'P4'
});

class AlertRouter {
  constructor(options = {}) {
    this.dedupWindowMs = options.dedupWindowMs || 10 * 60 * 1000;
    this.fatigueLimit = options.fatigueLimit || 3;
    this.fatigueWindowMs = 60 * 60 * 1000;
    this._recentAlerts = new Map();
    this._alertsHistory = [];
    this.incidentManager = options.incidentManager || null;
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

    const team = this._mapToTeam(type);
    logger.error(`[AlertRouter] [${severity}] Routed alert for ${service}/${type} to team: ${team}. Message: ${message}`);

    if ((severity === SEVERITIES.P1 || severity === SEVERITIES.P2) && this.incidentManager) {
      try {
        const title = `Auto Incident: [${severity}] ${message}`;
        this.incidentManager.createIncident(severity, title, `Alert: ${description || message}`);
      } catch (err) {
        logger.error(`[AlertRouter] Failed to auto-create incident: ${err.message}`);
      }
    }

    if (severity === SEVERITIES.P1) {
      setTimeout(() => {
        logger.warn(`[AlertRouter] [Escalation] Checking P1 acknowledgement status for: ${dedupKey}`);
      }, 5000);
    }

    return { status: 'ROUTED', team };
  }

  _mapToTeam(type) {
    const mappings = {
      'db_error': 'database-team',
      'redis_error': 'infra-team',
      'scraping_failure': 'scraper-team',
      'network_timeout': 'network-team',
      'api_latency': 'backend-team',
      'auth_failure': 'security-team'
    };
    return mappings[type] || 'ops-oncall';
  }
}

module.exports = AlertRouter;
