'use strict';

/**
 * SecurityTestRunner.js
 * SITAM Smart ERP — DevSecOps DAST Runner
 *
 * Orchestrates execution of the dynamic fuzzer suite, compiling results
 * and exposing execution outcomes for pipeline automation gates.
 *
 * Phase 2: Prometheus metrics injection — emits dast_test_runs_total counter
 * and passes the shared registry into APIFuzzer for its own gauge.
 */

const APIFuzzer = require('./APIFuzzer');
const logger = require('../../services/logger');

class SecurityTestRunner {
  constructor(options = {}) {
    this.metrics = options.metrics || null;
    // Pass shared registry into APIFuzzer so its gauge registers on same registry
    this.fuzzer = new APIFuzzer(options);
    this._initMetrics();
  }

  _initMetrics() {
    if (!this.metrics) return;
    try {
      const { Counter } = require('prom-client');
      this.dastTestRunsTotal = new Counter({
        name: 'dast_test_runs_total',
        help: 'Total number of completed DAST test suite runs',
        registers: [this.metrics]
      });
    } catch (err) {
      logger.warn(`[SecurityTestRunner] Failed to initialize metrics: ${err.message}`);
    }
  }

  async runAllTests() {
    logger.info('[SecurityTestRunner] Running all DAST dynamic tests...');
    try {
      const report = await this.fuzzer.runFuzzing();
      if (this.dastTestRunsTotal) {
        this.dastTestRunsTotal.inc();
      }
      logger.info(`[SecurityTestRunner] DAST run complete. Findings count: ${report.findingsCount}`);
      return report;
    } catch (err) {
      logger.error(`[SecurityTestRunner] DAST run failed: ${err.message}`);
      throw err;
    }
  }
}

module.exports = SecurityTestRunner;
