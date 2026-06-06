'use strict';

/**
 * IncidentManager.js
 * SITAM Smart ERP — SRE Incident Lifecycle Manager
 *
 * Implements SRE Incident Command System (ICS) incident lifecycles, transition paths,
 * timelines, and OTel trace correlation. Persists states to a local JSON file that mirrors
 * database persistence for resilience when PostgreSQL is offline.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const logger = require('../../services/logger');
const sreService = require('../../services/sreService');

const INCIDENTS_FILE_PATH = path.resolve(__dirname, '../../logs/sre_incidents.json');

class IncidentManager {
  constructor(options = {}) {
    this.filePath = options.filePath || INCIDENTS_FILE_PATH;
    this.postmortemGenerator = options.postmortemGenerator || null;
    this.metrics = options.metrics || null;
    this._loadOrCreateIncidents();
    this._initMetrics();
  }

  _initMetrics() {
    if (!this.metrics) return;
    try {
      const { Gauge } = require('prom-client');
      this.activeIncidentsGauge = new Gauge({
        name: 'incident_active_count',
        help: 'Total number of active (unresolved) incidents',
        labelNames: ['severity'],
        registers: [this.metrics]
      });
    } catch (err) {
      logger.warn(`[IncidentManager] Failed to initialize metrics: ${err.message}`);
    }
  }

  _publishMetrics() {
    if (!this.activeIncidentsGauge) return;
    const active = this.listActive();
    const counts = { SEV1: 0, SEV2: 0, SEV3: 0, SEV4: 0 };
    for (const inc of active) {
      const sev = inc.severity;
      if (counts[sev] !== undefined) counts[sev]++;
    }
    for (const [sev, count] of Object.entries(counts)) {
      this.activeIncidentsGauge.labels(sev).set(count);
    }
  }

  _loadOrCreateIncidents() {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    if (fs.existsSync(this.filePath)) {
      try {
        this.incidents = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
        return;
      } catch (err) {
        logger.warn(`[IncidentManager] Failed to read incidents file: ${err.message}`);
      }
    }
    this.incidents = [];
    this._saveIncidents();
  }

  _saveIncidents() {
    fs.writeFileSync(this.filePath, JSON.stringify(this.incidents, null, 2), 'utf8');
    this._publishMetrics();
  }

  createIncident(severity, title, trigger) {
    const incidentId = `INC-${Date.now()}-${crypto.randomUUID().substring(0, 4)}`;
    logger.error(`[IncidentManager] CREATING INCIDENT [${severity}]: ${title}. Trigger: ${trigger}`);

    const commanderRole = 'Incident Commander';
    const techLead = 'On-Call Dev Lead';
    const commsLead = 'On-Call Comms Lead';
    const opsLead = 'On-Call Ops Lead';

    const incident = {
      incidentId,
      title,
      severity,
      status: 'OPEN',
      owner: 'unassigned',
      commanderRole,
      techLead,
      commsLead,
      opsLead,
      timeline: [
        {
          timestamp: new Date().toISOString(),
          event: `Incident created. Trigger: ${trigger}`,
          actor: 'System'
        }
      ],
      impactStatement: 'Evaluating system impact...',
      resolution: '',
      rootCause: '',
      relatedAlerts: [],
      relatedTraces: [],
      createdAt: new Date().toISOString(),
      resolvedAt: null
    };

    this.incidents.push(incident);
    this._saveIncidents();

    try {
      sreService.captureForensicSnapshot(incidentId);
    } catch (e) {
      logger.error(`[IncidentManager] Failed to capture forensic snapshot: ${e.message}`);
    }

    return incident;
  }

  updateStatus(incidentId, status, actor) {
    logger.info(`[IncidentManager] Updating status of ${incidentId} to ${status} by ${actor}`);
    const incident = this.incidents.find(i => i.incidentId === incidentId);
    if (!incident) throw new Error(`Incident not found: ${incidentId}`);

    incident.status = status;
    incident.timeline.push({
      timestamp: new Date().toISOString(),
      event: `Status updated to ${status}`,
      actor
    });

    if (status === 'RESOLVED') {
      incident.resolvedAt = new Date().toISOString();
    }

    this._saveIncidents();
    return incident;
  }

  transferOwnership(incidentId, newOwner, actor) {
    logger.info(`[IncidentManager] Transferring ownership of ${incidentId} to ${newOwner}`);
    const incident = this.incidents.find(i => i.incidentId === incidentId);
    if (!incident) throw new Error(`Incident not found: ${incidentId}`);

    const oldOwner = incident.owner;
    incident.owner = newOwner;
    incident.timeline.push({
      timestamp: new Date().toISOString(),
      event: `Ownership transferred from ${oldOwner} to ${newOwner}`,
      actor
    });

    this._saveIncidents();
    return incident;
  }

  linkAlert(incidentId, alertId) {
    const incident = this.incidents.find(i => i.incidentId === incidentId);
    if (!incident) throw new Error(`Incident not found: ${incidentId}`);

    if (!incident.relatedAlerts.includes(alertId)) {
      incident.relatedAlerts.push(alertId);
      incident.timeline.push({
        timestamp: new Date().toISOString(),
        event: `Linked alert: ${alertId}`,
        actor: 'System'
      });
      this._saveIncidents();
    }
  }

  linkTrace(incidentId, traceId) {
    const incident = this.incidents.find(i => i.incidentId === incidentId);
    if (!incident) throw new Error(`Incident not found: ${incidentId}`);

    if (!incident.relatedTraces.includes(traceId)) {
      incident.relatedTraces.push(traceId);
      incident.timeline.push({
        timestamp: new Date().toISOString(),
        event: `Linked OTel Trace: ${traceId}`,
        actor: 'System'
      });
      this._saveIncidents();
    }
  }

  async closeIncident(incidentId, resolution, rootCause, actor) {
    logger.info(`[IncidentManager] Closing incident ${incidentId}`);
    const incident = this.incidents.find(i => i.incidentId === incidentId);
    if (!incident) throw new Error(`Incident not found: ${incidentId}`);

    incident.status = 'RESOLVED';
    incident.resolution = resolution;
    incident.rootCause = rootCause;
    incident.resolvedAt = new Date().toISOString();
    incident.timeline.push({
      timestamp: new Date().toISOString(),
      event: `Incident resolved and closed. Resolution: ${resolution}. Root cause: ${rootCause}`,
      actor
    });

    this._saveIncidents();

    if (this.postmortemGenerator) {
      try {
        await this.postmortemGenerator.generate(incidentId);
      } catch (err) {
        logger.error(`[IncidentManager] Postmortem generation failed: ${err.message}`);
      }
    }

    return incident;
  }

  listActive() {
    return this.incidents.filter(i => i.status !== 'RESOLVED');
  }

  getIncident(incidentId) {
    return this.incidents.find(i => i.incidentId === incidentId) || null;
  }
}

module.exports = IncidentManager;
