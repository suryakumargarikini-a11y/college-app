'use strict';

/**
 * DevSecOpsScheduler.js
 * SITAM Smart ERP — DevSecOps Control Plane Scheduler (Phase 1)
 *
 * Singleton scheduler that instantiates all 9 DevSecOps security modules with
 * proper dependency injection, registers their Prometheus gauges against the
 * shared metricsService registry, and executes security scans on background
 * intervals.
 *
 * Phase 1 Maturity Targets:
 *   INTEGRATED  — SecretGovernanceManager, KeyRotationScheduler,
 *                 VulnerabilityScanner, SecurityReportAggregator
 *   PARTIAL     — SBOMGenerator, ArtifactSigner, ProvenanceVerifier
 *   INSTANTIATED ONLY — APIFuzzer, SecurityTestRunner (dormant)
 *
 * Actual maturity score is determined at runtime by the forensic audit.
 * Evidence determines maturity — no score is hardcoded or targeted.
 *
 * Phase 2 additions:
 *   - SecurityTestRunner (+ APIFuzzer) activated on 6h interval
 *   - SecurityReportAggregator ingests DAST results written by APIFuzzer
 *   - securityReportAggregator exposed for DeploymentGovernor cross-wire in server.js
 */

const logger       = require('./logger');
const metricsService = require('./metricsService');

const SBOMGenerator           = require('../security/sbom/SBOMGenerator');
const ArtifactSigner          = require('../security/supply-chain/ArtifactSigner');
const ProvenanceVerifier      = require('../security/supply-chain/ProvenanceVerifier');
const VulnerabilityScanner    = require('../security/scanning/VulnerabilityScanner');
const SecurityReportAggregator = require('../security/scanning/SecurityReportAggregator');
const SecretGovernanceManager  = require('../security/secrets/SecretGovernanceManager');
const KeyRotationScheduler     = require('../security/secrets/KeyRotationScheduler');
const APIFuzzer                = require('../security/dast/APIFuzzer');
const SecurityTestRunner       = require('../security/dast/SecurityTestRunner');

// ─── Interval Cadences ────────────────────────────────────────────────────────
const INTERVAL_HOURLY   =  1 * 60 * 60 * 1000; //  1 h
const INTERVAL_6H       =  6 * 60 * 60 * 1000; //  6 h
const INTERVAL_DAILY    = 24 * 60 * 60 * 1000; // 24 h

class DevSecOpsScheduler {
    constructor() {
        this._started   = false;
        this._intervals = {};

        // Module references — populated in start()
        this.sbomGenerator        = null;
        this.artifactSigner       = null;
        this.provenanceVerifier   = null;
        this.vulnScanner          = null;
        this.reportAggregator     = null;
        this.secretManager        = null;
        this.keyRotationScheduler = null;
        this.apiFuzzer            = null;
        this.securityTestRunner   = null;
    }

    // ─── Lifecycle ────────────────────────────────────────────────────────────

    /**
     * Start the DevSecOps control plane.
     * Idempotent — multiple calls are safe.
     */
    start() {
        if (this._started) {
            logger.warn('[DevSecOpsScheduler] Already running — ignoring duplicate start().');
            return;
        }

        logger.info('[DevSecOpsScheduler] Activating DevSecOps control plane (Phase 1)...');

        const registry = metricsService.register;

        // ── Instantiate all modules ──────────────────────────────────────────

        this.sbomGenerator = new SBOMGenerator({ metrics: registry });

        this.artifactSigner = new ArtifactSigner();

        // ProvenanceVerifier uses an internal ArtifactSigner instance
        this.provenanceVerifier = new ProvenanceVerifier();

        this.vulnScanner = new VulnerabilityScanner();

        this.reportAggregator = new SecurityReportAggregator({ metrics: registry });

        this.secretManager = new SecretGovernanceManager({ metrics: registry });

        // KeyRotationScheduler reuses the same secretManager instance
        this.keyRotationScheduler = new KeyRotationScheduler({
            governanceManager: this.secretManager,
            metrics: registry
        });

        // Dormant in Phase 1 — activated in Phase 2 via 6h cycle
        // Pass shared metrics registry so APIFuzzer can emit dast_vulnerability_findings_total
        this.apiFuzzer         = null; // owned by SecurityTestRunner
        this.securityTestRunner = new SecurityTestRunner({ metrics: registry });

        // ── Hourly interval ──────────────────────────────────────────────────
        // SecretGovernanceManager + KeyRotationScheduler
        this._intervals.hourly = setInterval(() => {
            this._runHourly();
        }, INTERVAL_HOURLY);

        // ── 6-hour interval ──────────────────────────────────────────────────
        // VulnerabilityScanner + SecurityReportAggregator
        this._intervals.sixHours = setInterval(() => {
            this._runSixHourly();
        }, INTERVAL_6H);

        // ── Daily interval ───────────────────────────────────────────────────
        // SBOMGenerator → ArtifactSigner → ProvenanceVerifier
        this._intervals.daily = setInterval(() => {
            this._runDaily();
        }, INTERVAL_DAILY);

        // ── Immediate bootstrap run ──────────────────────────────────────────
        // Runs AFTER intervals are registered so that a bootstrap failure
        // cannot prevent interval scheduling or server startup.
        // Each bootstrap task is wrapped in its own try/catch — see _runBootstrap().
        this._started = true;
        logger.info('[DevSecOpsScheduler] Phase 1 active. Intervals: hourly, 6h, 24h.');

        this._runBootstrap();
    }

    /**
     * Stop all background intervals. Idempotent.
     */
    stop() {
        if (!this._started) return;

        for (const [name, id] of Object.entries(this._intervals)) {
            clearInterval(id);
            logger.info(`[DevSecOpsScheduler] Cleared interval: ${name}`);
        }
        this._intervals = {};
        this._started   = false;
        logger.info('[DevSecOpsScheduler] DevSecOps control plane stopped.');
    }

    // ─── Execution Handlers ───────────────────────────────────────────────────

    /**
     * Bootstrap run — executes the four INTEGRATED modules immediately on
     * startup so Prometheus metrics have live values from second 1.
     *
     * NOTE: SecurityTestRunner (DAST) is intentionally excluded from bootstrap
     * to avoid 20+ concurrent HTTP requests during server startup.
     * DAST runs on the 6-hour interval only.
     */
    _runBootstrap() {
        logger.info('[DevSecOpsScheduler] Running bootstrap security scan...');

        // Secret health assessment
        try {
            this.secretManager.assessHealth();
            logger.info('[DevSecOpsScheduler] Bootstrap: SecretGovernanceManager.assessHealth() OK');
        } catch (err) {
            logger.error(`[DevSecOpsScheduler] Bootstrap: SecretGovernanceManager error: ${err.message}`);
        }

        // Rotation plan
        try {
            this.keyRotationScheduler.generateRotationPlan();
            logger.info('[DevSecOpsScheduler] Bootstrap: KeyRotationScheduler.generateRotationPlan() OK');
        } catch (err) {
            logger.error(`[DevSecOpsScheduler] Bootstrap: KeyRotationScheduler error: ${err.message}`);
        }

        // Vulnerability scan (runs npm audit — may take a few seconds)
        try {
            const scanResult = this.vulnScanner.scan();
            logger.info(`[DevSecOpsScheduler] Bootstrap: VulnerabilityScanner.scan() OK — ${scanResult.summary.totalCount} findings`);
        } catch (err) {
            logger.error(`[DevSecOpsScheduler] Bootstrap: VulnerabilityScanner error: ${err.message}`);
        }

        // Security report aggregation
        try {
            const report = this.reportAggregator.aggregate();
            logger.info(`[DevSecOpsScheduler] Bootstrap: SecurityReportAggregator.aggregate() OK — score: ${report.score}`);
        } catch (err) {
            logger.error(`[DevSecOpsScheduler] Bootstrap: SecurityReportAggregator error: ${err.message}`);
        }
    }

    /**
     * Hourly cycle — secret health and rotation planning.
     */
    _runHourly() {
        logger.debug('[DevSecOpsScheduler] Running hourly DevSecOps cycle...');

        try {
            this.secretManager.assessHealth();
        } catch (err) {
            logger.error(`[DevSecOpsScheduler] Hourly: SecretGovernanceManager error: ${err.message}`);
        }

        try {
            this.keyRotationScheduler.generateRotationPlan();
        } catch (err) {
            logger.error(`[DevSecOpsScheduler] Hourly: KeyRotationScheduler error: ${err.message}`);
        }
    }

    /**
     * 6-hour cycle — vulnerability scan → DAST → report aggregation.
     * Order matters: scan + DAST write their JSON reports first,
     * then aggregate() reads them all in one pass.
     */
    _runSixHourly() {
        logger.debug('[DevSecOpsScheduler] Running 6-hour DevSecOps cycle...');

        try {
            this.vulnScanner.scan();
        } catch (err) {
            logger.error(`[DevSecOpsScheduler] 6h: VulnerabilityScanner error: ${err.message}`);
        }

        // DAST: run async, log result; errors must not block aggregation
        const runDast = async () => {
            try {
                const dastReport = await this.securityTestRunner.runAllTests();
                logger.info(`[DevSecOpsScheduler] 6h: DAST complete — ${dastReport.findingsCount} findings`);
            } catch (err) {
                logger.error(`[DevSecOpsScheduler] 6h: SecurityTestRunner error: ${err.message}`);
            } finally {
                // Aggregate AFTER DAST so the report file is on disk
                try {
                    const report = this.reportAggregator.aggregate();
                    logger.info(`[DevSecOpsScheduler] 6h: Aggregation complete — score: ${report.score}`);
                } catch (aggErr) {
                    logger.error(`[DevSecOpsScheduler] 6h: SecurityReportAggregator error: ${aggErr.message}`);
                }
            }
        };
        runDast();
    }

    /**
     * Daily cycle — SBOM generation, artifact signing, provenance verification.
     */
    _runDaily() {
        logger.debug('[DevSecOpsScheduler] Running daily DevSecOps cycle...');

        try {
            this.sbomGenerator.generateSnapshot();
            logger.info('[DevSecOpsScheduler] Daily: SBOMGenerator.generateSnapshot() OK');
        } catch (err) {
            logger.error(`[DevSecOpsScheduler] Daily: SBOMGenerator error: ${err.message}`);
        }

        try {
            // signLatestSnapshot reads the sbom via sbomGenerator.getLatest()
            this.artifactSigner.signLatestSnapshot(this.sbomGenerator);
            logger.info('[DevSecOpsScheduler] Daily: ArtifactSigner.signLatestSnapshot() OK');
        } catch (err) {
            logger.error(`[DevSecOpsScheduler] Daily: ArtifactSigner error: ${err.message}`);
        }

        try {
            // verifyBuild() checks server.js and package.json manifests
            this.provenanceVerifier.verifyBuild();
            logger.info('[DevSecOpsScheduler] Daily: ProvenanceVerifier.verifyBuild() OK');
        } catch (err) {
            logger.error(`[DevSecOpsScheduler] Daily: ProvenanceVerifier error: ${err.message}`);
        }
    }
}

// Export singleton instance
module.exports = new DevSecOpsScheduler();
