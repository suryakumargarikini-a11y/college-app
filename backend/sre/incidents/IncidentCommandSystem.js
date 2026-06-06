'use strict';

/**
 * IncidentCommandSystem.js
 * SITAM Smart ERP — SRE Incident Command System
 *
 * Coordinates assignments of Incident Commander, Technical Lead, Communications Lead,
 * and Operations Lead roles for active incidents, tracks MTTA (Mean Time to Acknowledge),
 * and audits structural escalation paths.
 */

const logger = require('../../services/logger');

class IncidentCommandSystem {
  constructor(options = {}) {
    this.incidentManager = options.incidentManager;
  }

  assignRole(incidentId, role, user, actor) {
    logger.info(`[IncidentCommandSystem] Assigning role ${role} for incident ${incidentId} to ${user}`);
    const incident = this.incidentManager.getIncident(incidentId);
    if (!incident) throw new Error(`Incident not found: ${incidentId}`);

    const roleFieldMap = {
      'COMMANDER': 'commanderRole',
      'TECH_LEAD': 'techLead',
      'COMMS_LEAD': 'commsLead',
      'OPS_LEAD': 'opsLead'
    };

    const field = roleFieldMap[role];
    if (!field) throw new Error(`Invalid ICS role: ${role}`);

    const oldUser = incident[field];
    incident[field] = user;
    
    incident.timeline.push({
      timestamp: new Date().toISOString(),
      event: `ICS Role ${role} reassigned from ${oldUser} to ${user}`,
      actor
    });

    this.incidentManager._saveIncidents();
    return incident;
  }

  calculateResponseTime(incidentId) {
    const incident = this.incidentManager.getIncident(incidentId);
    if (!incident) throw new Error(`Incident not found: ${incidentId}`);

    const creationTime = new Date(incident.createdAt).getTime();
    let ackTime = null;

    for (const event of incident.timeline) {
      if (event.event.includes('Status updated to INVESTIGATING') || event.event.includes('Ownership transferred')) {
        ackTime = new Date(event.timestamp).getTime();
        break;
      }
    }

    if (!ackTime) return null;

    const responseTimeMs = ackTime - creationTime;
    return responseTimeMs / 1000;
  }
}

module.exports = IncidentCommandSystem;
