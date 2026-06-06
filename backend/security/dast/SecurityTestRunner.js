'use strict';

/**
 * SecurityTestRunner.js
 * SITAM Smart ERP — DevSecOps DAST Runner
 *
 * Orchestrates execution of the dynamic fuzzer suite, compiling results
 * and exposing execution outcomes for pipeline automation gates.
 */

const APIFuzzer = require('./APIFuzzer');
const logger = require('../../services/logger');

class SecurityTestRunner {
  constructor(options = {}) {
    this.fuzzer = new APIFuzzer(options);
  }

  async runAllTests() {
    logger.info('[SecurityTestRunner] Running all DAST dynamic tests...');
    try {
      const report = await this.fuzzer.runFuzzing();
      logger.info(`[SecurityTestRunner] DAST run complete. Findings count: ${report.findingsCount}`);
      return report;
    } catch (err) {
      logger.error(`[SecurityTestRunner] DAST run failed: ${err.message}`);
      throw err;
    }
  }
}

module.exports = SecurityTestRunner;
