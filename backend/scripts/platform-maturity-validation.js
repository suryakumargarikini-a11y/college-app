'use strict';

/**
 * platform-maturity-validation.js
 * SITAM Smart ERP — Platform Maturity Verification Suite
 *
 * Runs an extensive test suite verifying correct operation across all 12
 * compliance, observability, platform maturity, and SRE modules.
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

// Core Components
const SBOMGenerator = require('../security/sbom/SBOMGenerator');
const ArtifactSigner = require('../security/supply-chain/ArtifactSigner');
const ProvenanceVerifier = require('../security/supply-chain/ProvenanceVerifier');
const VulnerabilityScanner = require('../security/scanning/VulnerabilityScanner');
const SecurityReportAggregator = require('../security/scanning/SecurityReportAggregator');
const SecretGovernanceManager = require('../security/secrets/SecretGovernanceManager');
const KeyRotationScheduler = require('../security/secrets/KeyRotationScheduler');
const APIFuzzer = require('../security/dast/APIFuzzer');
const SecurityTestRunner = require('../security/dast/SecurityTestRunner');
const SLOFramework = require('../observability/slo/SLOFramework');
const ErrorBudgetGovernor = require('../observability/slo/ErrorBudgetGovernor');
const SyntheticMonitor = require('../monitoring/synthetic/SyntheticMonitor');
const BusinessMetricsCollector = require('../observability/business/BusinessMetricsCollector');
const AlertRouter = require('../observability/alerting/AlertRouter');
const IncidentManager = require('../sre/incidents/IncidentManager');
const IncidentCommandSystem = require('../sre/incidents/IncidentCommandSystem');
const PostmortemGenerator = require('../sre/postmortems/PostmortemGenerator');
const ReliabilityScorecardEngine = require('../sre/scorecards/ReliabilityScorecardEngine');
const DeploymentGovernor = require('../sre/deployment/DeploymentGovernor');
const ReleaseGovernor = require('../sre/releases/ReleaseGovernor');
const PlatformMaturityEngine = require('../platform/maturity/PlatformMaturityEngine');
const ServiceDependencyGraph = require('../observability/topology/ServiceDependencyGraph');
const ImpactAnalysisEngine = require('../observability/topology/ImpactAnalysisEngine');

const testSuite = {
  tests: [],
  add(name, fn) {
    this.tests.push({ name, fn });
  },
  async run() {
    let passed = 0;
    let failed = 0;
    console.log('\n==================================================');
    console.log('SITAM Smart ERP — Platform Maturity Validation Suite');
    console.log(`Running ${this.tests.length} automated compliance tests...`);
    console.log('==================================================\n');

    for (const test of this.tests) {
      try {
        await test.fn();
        console.log(`[PASS] ${test.name}`);
        passed++;
      } catch (err) {
        console.error(`[FAIL] ${test.name}`);
        console.error(err);
        failed++;
      }
    }

    console.log('\n==================================================');
    console.log(`Execution Complete. Passed: ${passed}, Failed: ${failed}`);
    console.log('==================================================\n');

    if (failed > 0) {
      process.exit(1);
    } else {
      process.exit(0);
    }
  }
};

// ─── 1. SBOM GENERATOR TESTS ──────────────────────────────────────────────────
testSuite.add('SBOM: Instantiation defaults', () => {
  const gen = new SBOMGenerator();
  assert.ok(gen.packageJsonPath);
  assert.ok(gen.packageLockJsonPath);
  assert.ok(gen.snapshotsDir);
});

testSuite.add('SBOM: Generate snapshot outputs', () => {
  const gen = new SBOMGenerator();
  const res = gen.generate();
  assert.ok(fs.existsSync(res.jsonPath));
  assert.ok(fs.existsSync(res.xmlPath));
  assert.ok(res.componentCount > 0);
});

testSuite.add('SBOM: Risk assessment validation', () => {
  const gen = new SBOMGenerator();
  const summary = gen.getRiskSummary([{ name: 'test-gpl', version: '1.0.0', licenses: [{ license: { id: 'GPL-3.0' } }] }]);
  assert.strictEqual(summary.highRiskCount, 1);
  assert.strictEqual(summary.riskLevel, 'HIGH');
});

testSuite.add('SBOM: Latest snapshot retrieval', () => {
  const gen = new SBOMGenerator();
  const latest = gen.getLatest();
  assert.ok(latest);
  assert.strictEqual(latest.bomFormat, 'CycloneDX');
});

// ─── 2. ARTIFACT SIGNER TESTS ─────────────────────────────────────────────────
testSuite.add('Signer: Sign payload and verify', () => {
  const signer = new ArtifactSigner();
  const payload = 'important-code-asset';
  const sigRecord = signer.signArtifact('test-asset', payload);
  
  assert.ok(sigRecord.signature);
  assert.strictEqual(sigRecord.artifactName, 'test-asset');
  
  const verified = signer.verifyArtifact('test-asset', payload);
  assert.strictEqual(verified, true);
});

testSuite.add('Signer: Tamper-detection check', () => {
  const signer = new ArtifactSigner();
  const payload = 'original-payload';
  signer.signArtifact('tamper-asset', payload);
  
  const verified = signer.verifyArtifact('tamper-asset', 'altered-payload');
  assert.strictEqual(verified, false);
});

testSuite.add('Signer: Provenance SLSA mapping', () => {
  const signer = new ArtifactSigner();
  const provRecord = signer.generateProvenance('test-asset', 'dummyhash');
  assert.ok(provRecord.provenance);
  assert.strictEqual(provRecord.provenance.subject[0].name, 'test-asset');
});

// ─── 3. PROVENANCE VERIFIER TESTS ──────────────────────────────────────────────
testSuite.add('Verifier: Validate build components', () => {
  const signer = new ArtifactSigner();
  const verifier = new ProvenanceVerifier();
  
  const serverPath = path.resolve(__dirname, '../server.js');
  const packagePath = path.resolve(__dirname, '../package.json');
  
  if (fs.existsSync(serverPath)) signer.signArtifact('server', fs.readFileSync(serverPath));
  if (fs.existsSync(packagePath)) signer.signArtifact('package', fs.readFileSync(packagePath));
  
  const res = verifier.verifyBuild();
  assert.strictEqual(res, true);
});

// ─── 4. VULNERABILITY SCANNER TESTS ───────────────────────────────────────────
testSuite.add('Scanner: Scan execution and format verification', () => {
  const scanner = new VulnerabilityScanner();
  const res = scanner.runScan();
  assert.ok(res.reportDir);
  assert.ok(res.summary);
  assert.ok(typeof res.summary.totalCount === 'number');
});

// ─── 5. SECURITY REPORT AGGREGATOR TESTS ──────────────────────────────────────
testSuite.add('Aggregator: Collate results and risk index calculation', () => {
  const scanner = new VulnerabilityScanner();
  const aggregator = new SecurityReportAggregator();
  const scan = scanner.runScan();
  
  const aggReport = aggregator.aggregate();
  assert.ok(aggReport.aggregatedAt);
  assert.ok(typeof aggReport.score === 'number');
  assert.ok(Array.isArray(aggReport.remediations));
});

// ─── 6. SECRETS GOVERNANCE TESTS ──────────────────────────────────────────────
testSuite.add('Secrets: Assess health ratios and rotation flags', () => {
  const mgr = new SecretGovernanceManager();
  const results = mgr.assessSecrets();
  
  assert.ok(results.length > 0);
  assert.ok(results[0].healthScore >= 0 && results[0].healthScore <= 100);
});

testSuite.add('Secrets: Trigger secret rotation', () => {
  const mgr = new SecretGovernanceManager();
  const secret = mgr.rotateSecret('JWT_SECRET');
  assert.ok(secret);
  assert.strictEqual(secret.status, 'ACTIVE');
});

testSuite.add('Secrets: Revoke credential status', () => {
  const mgr = new SecretGovernanceManager();
  const secret = mgr.revokeSecret('API_KEY');
  assert.strictEqual(secret.status, 'REVOKED');
});

// ─── 7. KEY ROTATION SCHEDULER TESTS ──────────────────────────────────────────
testSuite.add('Scheduler: Generate rotation action items', () => {
  const scheduler = new KeyRotationScheduler();
  const actions = scheduler.checkRotationSchedules();
  assert.ok(Array.isArray(actions));
});

// ─── 8. DAST FUZZER TESTS ────────────────────────────────────────────────────
testSuite.add('DAST: Setup testing framework parameters', () => {
  const runner = new SecurityTestRunner();
  assert.ok(runner.fuzzer);
});

// ─── 9. SLO FRAMEWORK TESTS ──────────────────────────────────────────────────
testSuite.add('SLO: Calculate compliance and remaining budgets', () => {
  const framework = new SLOFramework();
  const budgets = framework.calculateBudgets({
    api_success_rate: { success: 9995, total: 10000 }
  });
  
  const apiSlo = budgets.find(b => b.name === 'api_success_rate');
  assert.ok(apiSlo);
  assert.strictEqual(apiSlo.compliance, 0.9995);
});

// ─── 10. ERROR BUDGET GOVERNOR TESTS ──────────────────────────────────────────
testSuite.add('Governor: Check safety verdict', () => {
  const gov = new ErrorBudgetGovernor();
  const safety = gov.assessDeploymentSafety();
  assert.ok(safety.recommendation);
  assert.ok(Array.isArray(safety.warnings));
});

// ─── 11. SYNTHETIC MONITOR TESTS ──────────────────────────────────────────────
testSuite.add('Synthetic: Availability probe check', () => {
  const monitor = new SyntheticMonitor();
  assert.ok(monitor._probeErpAvailability);
});

// ─── 12. INCIDENT MANAGER TESTS ───────────────────────────────────────────────
testSuite.add('Incident: Create incident and ICS details validation', () => {
  const mgr = new IncidentManager();
  const inc = mgr.createIncident('SEV2', 'Scraper connection timed out', 'ScraperTimeoutAlarm');
  
  assert.ok(inc.incidentId);
  assert.strictEqual(inc.severity, 'SEV2');
  assert.strictEqual(inc.status, 'OPEN');
});

testSuite.add('Incident: Transition lifecycle states', () => {
  const mgr = new IncidentManager();
  const inc = mgr.createIncident('SEV3', 'Database load spike', 'MetricThresholdAlert');
  
  mgr.updateStatus(inc.incidentId, 'INVESTIGATING', 'OperatorA');
  const fetched = mgr.getIncident(inc.incidentId);
  assert.strictEqual(fetched.status, 'INVESTIGATING');
});

// ─── 13. INCIDENT COMMAND SYSTEM TESTS ────────────────────────────────────────
testSuite.add('ICS: Calculate response acknowledgement time', () => {
  const mgr = new IncidentManager();
  const ics = new IncidentCommandSystem({ incidentManager: mgr });
  
  const inc = mgr.createIncident('SEV1', 'Core Outage', 'PingAlarm');
  mgr.updateStatus(inc.incidentId, 'INVESTIGATING', 'OnCallA');
  
  const delaySec = ics.calculateResponseTime(inc.incidentId);
  assert.ok(typeof delaySec === 'number');
});

// ─── 14. POSTMORTEM GENERATOR TESTS ───────────────────────────────────────────
testSuite.add('Postmortem: Build markdown summary', async () => {
  const mgr = new IncidentManager();
  const generator = new PostmortemGenerator({ incidentManager: mgr });
  const inc = mgr.createIncident('SEV1', 'Queue Stall', 'StallAlarm');
  
  const res = await generator.generate(inc.incidentId);
  assert.ok(fs.existsSync(res.mdPath));
  assert.ok(fs.existsSync(res.jsonPath));
});

// ─── 15. RELIABILITY SCORECARD TESTS ──────────────────────────────────────────
testSuite.add('Scorecard: Assess component performance score', () => {
  const engine = new ReliabilityScorecardEngine();
  const scorecards = engine.computeScorecards({
    erpScore: 92,
    browserScore: 95
  });
  
  assert.strictEqual(scorecards.erp.score, 92);
  assert.strictEqual(scorecards.erp.grade, 'A');
});

// ─── 16. DEPLOYMENT GOVERNOR TESTS ────────────────────────────────────────────
testSuite.add('DeployGov: Evaluate safety state recommendations', () => {
  const gov = new DeploymentGovernor();
  const res = gov.checkDeploymentSafety();
  assert.ok(res.recommendation);
});

// ─── 17. RELEASE GOVERNOR TESTS ───────────────────────────────────────────────
testSuite.add('ReleaseGov: Staging approval gate verification', () => {
  const gov = new ReleaseGovernor();
  const res = gov.evaluateRelease({ version: '1.2.0', hasTestedInStaging: false });
  assert.strictEqual(res.verdict, 'REJECTED');
  assert.ok(res.rejections.includes('Staging verification check missing (BLOCKED)'));
});

// ─── 18. SERVICE dependency TOPOLOGY TESTS ────────────────────────────────────
testSuite.add('Topology: Build component dependency map', () => {
  const graph = new ServiceDependencyGraph();
  const deps = graph.getDependencies('api-server');
  assert.ok(deps.includes('postgres'));
  assert.ok(deps.includes('redis'));
});

testSuite.add('Topology: Downstream propagation impact assessment', () => {
  const engine = new ImpactAnalysisEngine();
  const res = engine.analyzeImpact('postgres');
  assert.strictEqual(res.riskLevel, 'CRITICAL');
  assert.ok(res.impactedServices.includes('api-server'));
});

// ─── 19. PLATFORM MATURITY ENGINE TESTS ───────────────────────────────────────
testSuite.add('Maturity: Evaluate overall score metrics', async () => {
  const engine = new PlatformMaturityEngine();
  const res = await engine.evaluateMaturity();
  assert.ok(typeof res.maturityScore === 'number');
  assert.ok(res.complianceScore > 0);
  assert.ok(res.reliabilityScore > 0);
});

// Start suite run
testSuite.run();
