'use strict';

/**
 * PostmortemGenerator.js
 * SITAM Smart ERP — Automated Postmortem Generator
 *
 * Compiles SRE incident timelines, root causes, resolution paths, and OTel trace links,
 * producing structured Markdown and JSON postmortem review reports.
 */

const fs = require('fs');
const path = require('path');
const logger = require('../../services/logger');

class PostmortemGenerator {
  constructor(options = {}) {
    this.incidentManager = options.incidentManager;
    this.postmortemsDir = options.postmortemsDir || path.resolve(__dirname, '../../logs/postmortems');
  }

  async generate(incidentId) {
    logger.info(`[PostmortemGenerator] Generating postmortem for incident: ${incidentId}`);
    const incident = this.incidentManager.getIncident(incidentId);
    if (!incident) throw new Error(`Incident not found: ${incidentId}`);

    const timelineMarkdown = (incident.timeline || [])
      .map(t => `- **[${t.timestamp}]** (${t.actor}): ${t.event}`)
      .join('\n');

    const markdownContent = `# Postmortem: ${incident.title}

## Executive Summary
**Incident ID:** ${incident.incidentId}
**Severity:** ${incident.severity}
**Created At:** ${incident.createdAt}
**Resolved At:** ${incident.resolvedAt || 'N/A'}
**Duration:** ${incident.resolvedAt ? ((new Date(incident.resolvedAt) - new Date(incident.createdAt)) / 1000).toFixed(1) + ' seconds' : 'Open'}
**Incident Commander:** ${incident.commanderRole}
**Technical Lead:** ${incident.techLead}

## Timeline
${timelineMarkdown}

## Root Cause Analysis
${incident.rootCause || 'Root cause investigation pending.'}

## Impact Assessment
${incident.impactStatement || 'Assessing total user/service impact.'}

## Resolution Steps
${incident.resolution || 'Resolution details pending.'}

## Lessons Learned
- Verify automated detection alerting thresholds are calibrated to prevent delay.
- Ensure redundant failover controls are validated in prior load windows.

## Action Items
1. [ ] Calibrate SLIs/SLOs triggers for alert rule mappings.
2. [ ] Review log traces link: ${(incident.relatedTraces || []).join(', ') || 'None linked'}.
`;

    fs.mkdirSync(this.postmortemsDir, { recursive: true });
    
    const mdPath = path.join(this.postmortemsDir, `postmortem-${incidentId}.md`);
    fs.writeFileSync(mdPath, markdownContent, 'utf8');

    const jsonPath = path.join(this.postmortemsDir, `postmortem-${incidentId}.json`);
    const jsonRecord = {
      incidentId: incident.incidentId,
      title: incident.title,
      severity: incident.severity,
      durationSec: incident.resolvedAt ? (new Date(incident.resolvedAt) - new Date(incident.createdAt)) / 1000 : null,
      rootCause: incident.rootCause,
      impactStatement: incident.impactStatement,
      resolution: incident.resolution,
      actionItemsCount: 2
    };
    fs.writeFileSync(jsonPath, JSON.stringify(jsonRecord, null, 2), 'utf8');

    logger.info(`[PostmortemGenerator] Postmortem generated successfully. Markdown: ${mdPath}, JSON: ${jsonPath}`);
    return { mdPath, jsonPath };
  }
}

module.exports = PostmortemGenerator;
