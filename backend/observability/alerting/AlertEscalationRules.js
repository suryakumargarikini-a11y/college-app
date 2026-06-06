'use strict';

/**
 * AlertEscalationRules.js
 * SITAM Smart ERP — Alert Escalation Rules
 *
 * Defines the ownership matrix and timeout-based escalation policy stages for
 * different alert severity levels.
 */

module.exports = {
  ownershipMatrix: {
    database: {
      team: 'database-team',
      onCall: 'db-oncall@sitams.org',
      fallback: 'infrastructure-lead@sitams.org'
    },
    redis: {
      team: 'infra-team',
      onCall: 'infra-oncall@sitams.org',
      fallback: 'sre-lead@sitams.org'
    },
    scraper: {
      team: 'scraper-team',
      onCall: 'scraper-oncall@sitams.org',
      fallback: 'backend-lead@sitams.org'
    },
    api: {
      team: 'backend-team',
      onCall: 'backend-oncall@sitams.org',
      fallback: 'engineering-director@sitams.org'
    }
  },
  escalationRules: [
    {
      severity: 'P1',
      stages: [
        { timeoutMs: 0, notify: 'onCall' },
        { timeoutMs: 5 * 60 * 1000, notify: 'fallback' },
        { timeoutMs: 15 * 60 * 1000, notify: 'pagerduty-secondary-escalation' }
      ]
    },
    {
      severity: 'P2',
      stages: [
        { timeoutMs: 0, notify: 'onCall' },
        { timeoutMs: 15 * 60 * 1000, notify: 'fallback' }
      ]
    }
  ]
};
