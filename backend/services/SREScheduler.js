'use strict';

/**
 * SREScheduler.js
 * SITAM Smart ERP — SRE Control Plane Scheduler (Phase 1)
 *
 * Singleton scheduler that instantiates all six SRE modules with proper
 * dependency injection, registers their custom gauges with the shared
 * Prometheus registry, and evaluates scorecards and governance on intervals.
 */

const logger = require('./logger');
const metricsService = require('./metricsService');

const IncidentManager = require('../sre/incidents/IncidentManager');
const IncidentCommandSystem = require('../sre/incidents/IncidentCommandSystem');
const PostmortemGenerator = require('../sre/postmortems/PostmortemGenerator');
const ReliabilityScorecardEngine = require('../sre/scorecards/ReliabilityScorecardEngine');
const DeploymentGovernor = require('../sre/deployment/DeploymentGovernor');
const ReleaseGovernor = require('../sre/releases/ReleaseGovernor');

class SREScheduler {
    constructor() {
        this._intervals = {};
        this._started = false;

        // Modules
        this.incidentManager = null;
        this.incidentCommandSystem = null;
        this.postmortemGenerator = null;
        this.scorecardEngine = null;
        this.deploymentGovernor = null;
        this.releaseGovernor = null;
    }

    /**
     * Start the SRE scheduler and initialize all SRE modules.
     * Idempotent protection prevents duplicate starts.
     */
    start() {
        if (this._started) {
            logger.warn('[SREScheduler] Already started — ignoring duplicate start() call.');
            return;
        }

        logger.info('[SREScheduler] Waking up SRE control plane and governance...');

        const registry = metricsService.register;

        // 1. Instantiate modules using dependency injection
        this.incidentManager = new IncidentManager({
            metrics: registry
        });

        this.postmortemGenerator = new PostmortemGenerator({
            incidentManager: this.incidentManager
        });

        // Cross-wire postmortem generator into incident manager
        this.incidentManager.postmortemGenerator = this.postmortemGenerator;

        this.incidentCommandSystem = new IncidentCommandSystem({
            incidentManager: this.incidentManager
        });

        // Cross-wire incident command system into incident manager
        this.incidentManager.incidentCommandSystem = this.incidentCommandSystem;

        this.scorecardEngine = new ReliabilityScorecardEngine({
            metrics: registry
        });

        const obsScheduler = require('./ObservabilityScheduler');
        if (obsScheduler && obsScheduler.alertRouter) {
            obsScheduler.alertRouter.incidentManager = this.incidentManager;
        }

        this.deploymentGovernor = new DeploymentGovernor({
            incidentManager: this.incidentManager,
            errorBudgetGovernor: obsScheduler.errorBudgetGovernor,
            metrics: registry
        });

        this.releaseGovernor = new ReleaseGovernor({
            deploymentGovernor: this.deploymentGovernor,
            metrics: registry
        });

        // 2. Set background interval for scorecard and governance evaluation (every 30 seconds)
        this._intervals.sreEvaluation = setInterval(async () => {
            try {
                logger.debug('[SREScheduler] Executing periodic SRE evaluation cycle...');
                
                // Compute scorecards (updates reliability_scorecard_value gauge)
                await this.scorecardEngine.computeScorecards();

                // Evaluate deployment safety (updates deployment_safety_status gauge)
                this.deploymentGovernor.checkDeploymentSafety();

                // Evaluate release candidate governance (updates release_governance_risk_index gauge)
                this.releaseGovernor.evaluateRelease({
                    version: '1.0.0-production',
                    hasTestedInStaging: true
                });

            } catch (err) {
                logger.error(`[SREScheduler] Evaluation cycle error: ${err.message}`);
            }
        }, 30_000);

        this._started = true;
        logger.info('[SREScheduler] SRE Control Plane started. Evaluation interval set to 30s.');
    }

    /**
     * Tear down all scheduled intervals. Idempotent.
     */
    stop() {
        if (!this._started) {
            return;
        }

        for (const [name, id] of Object.entries(this._intervals)) {
            clearInterval(id);
            logger.info(`[SREScheduler] Cleared SRE interval: ${name}`);
        }
        this._intervals = {};
        this._started = false;
        logger.info('[SREScheduler] SRE Control Plane stopped.');
    }
}

// Export a singleton instance
module.exports = new SREScheduler();
