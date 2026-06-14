'use strict';

/**
 * ObservabilityScheduler.js
 * SITAM Smart ERP — Observability Interval Scheduler
 *
 * Single-ownership scheduler that wires SLOFramework, ErrorBudgetGovernor,
 * SyntheticMonitor, and BusinessMetricsCollector into the production runtime.
 *
 * Design goals:
 *  1. Prevent duplicate interval registration (idempotent start/stop).
 *  2. All observability modules share the metricsService.register registry.
 *  3. Alert routing is injected so the scheduler can escalate on probe failures.
 *  4. Graceful shutdown tears down all intervals cleanly.
 *
 * Runtime paths (after `start()` is called):
 *   Every 30s → SLOFramework.calculateBudgets() + ErrorBudgetGovernor.assessDeploymentSafety()
 *   Every 60s → SyntheticMonitor.runAllProbes()
 *   Every 60s → BusinessMetricsCollector.collectActiveUsers()
 */

const logger = require('./logger');

class ObservabilityScheduler {
    constructor() {
        this._intervals = {};
        this._started = false;
        // Lazy-loaded module instances (set during start())
        this.sloFramework = null;
        this.errorBudgetGovernor = null;
        this.syntheticMonitor = null;
        this.businessCollector = null;
        this.alertRouter = null;
    }

    /**
     * Start all observability intervals.
     * Idempotent — calling start() twice is a no-op.
     */
    start() {
        if (this._started) {
            logger.warn('[ObservabilityScheduler] Already started — ignoring duplicate start() call.');
            return;
        }

        logger.info('[ObservabilityScheduler] Bootstrapping observability runtime...');

        // ── 1. Load the shared Prometheus registry ────────────────────────────
        const metricsService = require('./metricsService');
        const registry = metricsService.register;

        // ── 2. Instantiate observability modules with shared registry ─────────
        const SLOFramework = require('../observability/slo/SLOFramework');
        const ErrorBudgetGovernor = require('../observability/slo/ErrorBudgetGovernor');
        const SyntheticMonitor = require('../monitoring/synthetic/SyntheticMonitor');
        const AlertRouter = require('../observability/alerting/AlertRouter');
        const AlertEscalationRules = require('../observability/alerting/AlertEscalationRules');

        this.sloFramework = new SLOFramework({ metrics: registry });

        this.errorBudgetGovernor = new ErrorBudgetGovernor({
            sloFramework: this.sloFramework,
            metrics: registry
        });

        this.syntheticMonitor = new SyntheticMonitor({ metrics: registry });

        // BusinessMetricsCollector is a singleton (exported as `new`) — reinitialise
        // with the shared registry so its gauges appear on /api/metrics
        const BusinessMetricsCollector = require('../observability/business/BusinessMetricsCollector').constructor;
        // The module exports `new BusinessMetricsCollector()`, so we access the class via
        // the exported instance's constructor and create a registry-aware replacement.
        this.businessCollector = require('../observability/business/BusinessMetricsCollector');
        // Patch the registry into the singleton's metrics (idempotent guard)
        if (!this.businessCollector._registryPatched) {
            const { Gauge, Counter, Histogram } = require('prom-client');

            const tryRegister = (name, fn) => {
                try {
                    return fn();
                } catch (err) {
                    logger.warn(`[ObservabilityScheduler] Metric '${name}' skipped (already registered): ${err.message}`);
                    return null;
                }
            };

            this.businessCollector.activeUsersGauge = tryRegister('active_users', () => new Gauge({
                name: 'active_users',
                help: 'Active users count (daily, weekly, monthly)',
                labelNames: ['period'],
                registers: [registry]
            })) || this.businessCollector.activeUsersGauge;

            this.businessCollector.featureAdoptionCounter = tryRegister('feature_adoption_total', () => new Counter({
                name: 'feature_adoption_total',
                help: 'Total requests per feature',
                labelNames: ['feature_name'],
                registers: [registry]
            })) || this.businessCollector.featureAdoptionCounter;

            this.businessCollector.syncCountCounter = tryRegister('syncs_completed_total', () => new Counter({
                name: 'syncs_completed_total',
                help: 'Total completions of student syncs by module',
                labelNames: ['module'],
                registers: [registry]
            })) || this.businessCollector.syncCountCounter;

            // Extended sync lifecycle metrics (user-required)
            this.businessCollector.syncStartedCounter = tryRegister('syncs_started_total', () => new Counter({
                name: 'syncs_started_total',
                help: 'Total sync jobs started',
                labelNames: ['module'],
                registers: [registry]
            }));

            this.businessCollector.syncFailedCounter = tryRegister('syncs_failed_total', () => new Counter({
                name: 'syncs_failed_total',
                help: 'Total sync jobs that failed',
                labelNames: ['module'],
                registers: [registry]
            }));

            this.businessCollector.syncDurationHistogram = tryRegister('business_sync_duration_seconds', () => new Histogram({
                name: 'business_sync_duration_seconds',
                help: 'Business-layer sync duration in seconds',
                labelNames: ['module'],
                buckets: [1, 2.5, 5, 10, 15, 20, 30, 45, 60],
                registers: [registry]
            }));

            this.businessCollector.queueWaitHistogram = tryRegister('sync_queue_wait_seconds', () => new Histogram({
                name: 'sync_queue_wait_seconds',
                help: 'Time a sync job spent waiting in queue before execution',
                labelNames: ['priority'],
                buckets: [0.1, 0.5, 1, 2.5, 5, 10, 30, 60],
                registers: [registry]
            }));

            this.businessCollector.syncRetryCounter = tryRegister('syncs_retried_total', () => new Counter({
                name: 'syncs_retried_total',
                help: 'Total sync jobs that were retried at least once',
                labelNames: ['reason'],
                registers: [registry]
            }));

            this.businessCollector._registryPatched = true;
            logger.info('[ObservabilityScheduler] BusinessMetricsCollector registry patched successfully.');
        }


        // ── 3. Wire AlertRouter with escalation rules ─────────────────────────
        this.alertRouter = new AlertRouter();
        // Store escalation rules on the router instance for downstream consumers
        this.alertRouter.escalationRules = AlertEscalationRules;

        // ── 4. Register intervals ─────────────────────────────────────────────

        // SLO + Error Budget (every 30 seconds)
        this._intervals.slo = setInterval(async () => {
            try {
                // getSloStats() is async — must be awaited to get real counter values
                const stats = metricsService.getSloStats ? await metricsService.getSloStats() : {};
                this.sloFramework.calculateBudgets(stats);
                const assessment = this.errorBudgetGovernor.assessDeploymentSafety();
                if (assessment.recommendation === 'FREEZE') {
                    this.alertRouter.routeAlert({
                        service: 'SLOFramework',
                        type: 'api_latency',
                        severity: 'P1',
                        message: 'Error budget exhausted — deployment FROZEN',
                        description: assessment.warnings.join('; ')
                    });
                }
            } catch (err) {
                logger.error(`[ObservabilityScheduler] SLO tick error: ${err.message}`);
            }
        }, 30_000);

        // Synthetic Monitor (every 60 seconds)
        this._intervals.synthetic = setInterval(async () => {
            try {
                const results = await this.syntheticMonitor.runAllProbes();
                const failed = Object.entries(results).filter(([, r]) => !r.success);
                if (failed.length > 0) {
                    this.alertRouter.routeAlert({
                        service: 'SyntheticMonitor',
                        type: 'scraping_failure',
                        severity: failed.length >= 3 ? 'P1' : 'P2',
                        message: `${failed.length} synthetic probes failed`,
                        description: failed.map(([k]) => k).join(', ')
                    });
                }
            } catch (err) {
                logger.error(`[ObservabilityScheduler] Synthetic tick error: ${err.message}`);
            }
        }, 60_000);

        // Business Metrics — Active User Collection (every 60 seconds)
        this._intervals.business = setInterval(async () => {
            try {
                await this.businessCollector.collectActiveUsers();
            } catch (err) {
                logger.error(`[ObservabilityScheduler] Business metrics tick error: ${err.message}`);
            }
        }, 60_000);

        this._started = true;
        logger.info('[ObservabilityScheduler] Started. Intervals: SLO=30s, Synthetic=60s, Business=60s.');
    }

    /**
     * Tear down all intervals. Safe to call multiple times.
     */
    stop() {
        for (const [name, id] of Object.entries(this._intervals)) {
            clearInterval(id);
            logger.info(`[ObservabilityScheduler] Cleared interval: ${name}`);
        }
        this._intervals = {};
        this._started = false;
        logger.info('[ObservabilityScheduler] All intervals stopped.');
    }

    /**
     * Expose the shared AlertRouter so other modules (errorHandler, circuitBreaker)
     * can send alerts without creating their own router instances.
     * Returns null before start() is called.
     */
    getAlertRouter() {
        return this.alertRouter;
    }

    /**
     * Expose the shared BusinessMetricsCollector so worker.js and controllers
     * can call trackActiveUser / trackSyncCompleted without re-instantiating.
     */
    getBusinessCollector() {
        return this.businessCollector;
    }
}

// Singleton — the entire process shares one scheduler
module.exports = new ObservabilityScheduler();
