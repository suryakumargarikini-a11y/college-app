'use strict';

/**
 * check-deployment-safety.js
 * SITAM Smart ERP — CI/CD Pipeline Safety Check Gate
 *
 * Runs as a pipeline execution hook, evaluating SLO budgets and active incident metrics
 * via DeploymentGovernor to determine if code deployment should proceed. Exits with non-zero
 * code on FREEZE conditions to automatically halt the CI pipeline build.
 */

const DeploymentGovernor = require('../sre/deployment/DeploymentGovernor');
const logger = require('../services/logger');

async function runCheck() {
  logger.info('[CI] Running Deployment Safety Gate Check...');
  const governor = new DeploymentGovernor();
  const verdict = governor.checkDeploymentSafety();

  console.log(`\n==================================================`);
  console.log(`DEPLOYMENT VERDICT: ${verdict.recommendation}`);
  console.log(`RISK INDEX: ${verdict.riskScore}/100`);
  console.log(`==================================================\n`);

  if (verdict.warnings.length > 0) {
    console.log('Warnings/Violations:');
    verdict.warnings.forEach(w => console.log(`- ${w}`));
    console.log('');
  }

  if (verdict.recommendation === 'FREEZE') {
    console.error('FAIL: Deployment blocked by SRE safety gates.');
    process.exit(1);
  } else if (verdict.recommendation === 'CAUTION') {
    console.log('WARNING: Proceed with caution. Manual verification recommended.');
    process.exit(0);
  } else {
    console.log('SUCCESS: Deployment safety checks passed.');
    process.exit(0);
  }
}

runCheck().catch(err => {
  console.error('Failed to execute deployment checks:', err);
  process.exit(1);
});
