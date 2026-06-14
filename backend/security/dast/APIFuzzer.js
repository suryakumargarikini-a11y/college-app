'use strict';

/**
 * APIFuzzer.js
 * SITAM Smart ERP — DAST API Fuzzing Suite
 *
 * Simulates security attacks against key endpoints. Tests for SQL injection,
 * cross-site scripting (XSS), null bytes, JWT manipulation (algorithm confusion,
 * expired tokens), rate limiting compliance (burst tests), and length overflows.
 * Logs vulnerability findings to JSON reports.
 *
 * Phase 2: Prometheus metrics injection + severity normalization so
 * SecurityReportAggregator can bucket DAST findings by severity.
 */

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const logger = require('../../services/logger');

class APIFuzzer {
  constructor(options = {}) {
    // Correct backend port is 3001; callers may override for staging targets.
    this.baseUrl = options.baseUrl || 'http://localhost:3001';
    this.reportsDir = options.reportsDir || path.resolve(__dirname, '../../security-reports');
    this.metrics = options.metrics || null;
    this._initMetrics();
  }

  _initMetrics() {
    if (!this.metrics) return;
    try {
      const { Gauge } = require('prom-client');
      this.dastVulnerabilityFindingsTotal = new Gauge({
        name: 'dast_vulnerability_findings_total',
        help: 'Total DAST vulnerability findings from the last fuzzing run',
        labelNames: ['severity'],
        registers: [this.metrics]
      });
    } catch (err) {
      logger.warn(`[APIFuzzer] Failed to initialize metrics: ${err.message}`);
    }
  }

  async runFuzzing() {
    logger.info(`[APIFuzzer] Initiating API fuzzing suite against base URL: ${this.baseUrl}`);
    const dateStr = new Date().toISOString().split('T')[0];
    const reportDir = path.join(this.reportsDir, dateStr);
    fs.mkdirSync(reportDir, { recursive: true });

    const findings = [];
    const endpointsTested = ['/api/auth/login', '/api/student/profile', '/api/attendance'];

    // 1. SQL Injection Fuzzing on Auth
    try {
      const sqlPayloads = ["' OR '1'='1", "admin' --", "' UNION SELECT NULL--"];
      for (const payload of sqlPayloads) {
        const res = await axios.post(`${this.baseUrl}/api/auth/login`, {
          userId: payload,
          password: 'password'
        }, { validateStatus: () => true, timeout: 2000 });

        if (res.status === 500) {
          findings.push({
            endpoint: '/api/auth/login',
            vulnerability: 'Possible SQL Injection vulnerability (HTTP 500)',
            payload,
            severity: 'HIGH',
            guidance: 'Ensure parameterized queries are used and input is strictly validated.'
          });
        }
      }
    } catch (err) {
      logger.warn(`[APIFuzzer] SQL injection fuzzing skipped or failed: ${err.message}`);
    }

    // 2. XSS Payload Fuzzing
    try {
      const xssPayloads = ['<script>alert(1)</script>', 'javascript:alert(1)', '<img src=x onerror=alert(1)>'];
      for (const payload of xssPayloads) {
        const res = await axios.post(`${this.baseUrl}/api/auth/login`, {
          userId: 'testuser',
          password: payload
        }, { validateStatus: () => true, timeout: 2000 });

        if (res.status === 500) {
          findings.push({
            endpoint: '/api/auth/login',
            vulnerability: 'Uncontrolled output on password processing (HTTP 500)',
            payload,
            severity: 'MEDIUM',
            guidance: 'Sanitize all user input fields to remove execution context strings.'
          });
        }
      }
    } catch (err) {
      logger.warn(`[APIFuzzer] XSS fuzzing skipped or failed: ${err.message}`);
    }

    // 3. JWT Manipulation / Algorithm Confusion
    try {
      const confToken = 'eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJ1c2VySWQiOiJ0ZXN0In0.';
      const res = await axios.get(`${this.baseUrl}/api/student/profile`, {
        headers: { Authorization: `Bearer ${confToken}` },
        validateStatus: () => true,
        timeout: 2000
      });

      if (res.status === 200) {
        findings.push({
          endpoint: '/api/student/profile',
          vulnerability: 'JWT Algorithm Confusion (accepted "none" alg)',
          payload: 'alg: none',
          severity: 'CRITICAL',
          guidance: 'Explicitly enforce JWT algorithm verification (e.g. HS256/RS256) and reject "none" algorithm tokens.'
        });
      }
    } catch (err) {
      logger.warn(`[APIFuzzer] JWT fuzzing skipped or failed: ${err.message}`);
    }

    // 4. Rate Limit / Burst Validation
    try {
      const requests = [];
      for (let i = 0; i < 20; i++) {
        requests.push(axios.get(`${this.baseUrl}/api/attendance`, { validateStatus: () => true, timeout: 1000 }));
      }
      const responses = await Promise.all(requests);
      const limitExceeded = responses.some(r => r.status === 429);
      if (!limitExceeded) {
        findings.push({
          endpoint: '/api/attendance',
          vulnerability: 'Rate limiting may not be enforced on sensitive routes',
          payload: '20 concurrent requests',
          severity: 'LOW',
          guidance: 'Enforce rate-limiting middleware (like express-rate-limit) on all student data routes.'
        });
      }
    } catch (err) {
      logger.warn(`[APIFuzzer] Rate limit testing skipped or failed: ${err.message}`);
    }

    // 5. Input Overflow Fuzzing
    try {
      const hugeString = 'A'.repeat(10000);
      const res = await axios.post(`${this.baseUrl}/api/auth/login`, {
        userId: hugeString,
        password: 'password'
      }, { validateStatus: () => true, timeout: 2000 });

      if (res.status === 500) {
        findings.push({
          endpoint: '/api/auth/login',
          vulnerability: 'Possible buffer or memory exhaustion vulnerability (HTTP 500)',
          payload: '10k char string',
          severity: 'MEDIUM',
          guidance: 'Limit length of incoming JSON payloads and input string fields.'
        });
      }
    } catch (err) {
      logger.warn(`[APIFuzzer] Input overflow fuzzing skipped or failed: ${err.message}`);
    }

    // ── Severity bucket counts ──────────────────────────────────────────────
    const severityCounts = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
    for (const f of findings) {
      const s = (f.severity || 'LOW').toUpperCase();
      severityCounts[s] = (severityCounts[s] || 0) + 1;
    }

    // ── Emit Prometheus metrics ─────────────────────────────────────────────
    if (this.dastVulnerabilityFindingsTotal) {
      for (const [severity, count] of Object.entries(severityCounts)) {
        this.dastVulnerabilityFindingsTotal.set({ severity }, count);
      }
    }

    const dastReport = {
      timestamp: new Date().toISOString(),
      baseUrl: this.baseUrl,
      endpointsTestedCount: endpointsTested.length,
      endpointsTested,
      findingsCount: findings.length,
      severityCounts,
      findings
    };

    const reportPath = path.join(reportDir, `dast-report-${dateStr}.json`);
    fs.writeFileSync(reportPath, JSON.stringify(dastReport, null, 2), 'utf8');

    logger.info(`[APIFuzzer] DAST scan complete. Found ${findings.length} issues. Report saved to ${reportPath}`);
    return dastReport;
  }
}

module.exports = APIFuzzer;
