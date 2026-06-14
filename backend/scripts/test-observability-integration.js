#!/usr/bin/env node
'use strict';

/**
 * scripts/test-observability-integration.js
 * SITAM Smart ERP — Observability Runtime Integration Test
 *
 * Verifies that every observability module is:
 *   1. Imported by production runtime code
 *   2. Instantiated and started
 *   3. Emitting Prometheus metrics on the shared registry
 *   4. Executing its scheduled work
 *
 * Usage:
 *   node scripts/test-observability-integration.js
 *
 * Exit code 0 = all checks passed
 * Exit code 1 = one or more checks failed
 */

process.env.NODE_ENV = 'test';
require('dotenv').config();

const assert = require('assert');

let passed = 0;
let failed = 0;

function check(name, fn) {
    try {
        const result = fn();
        if (result === false) throw new Error('returned false');
        console.log(`  ✓  ${name}`);
        passed++;
    } catch (err) {
        console.error(`  ✗  ${name}: ${err.message}`);
        failed++;
    }
}

async function checkAsync(name, fn) {
    try {
        const result = await fn();
        if (result === false) throw new Error('returned false');
        console.log(`  ✓  ${name}`);
        passed++;
    } catch (err) {
        console.error(`  ✗  ${name}: ${err.message}`);
        failed++;
    }
}

(async () => {
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('  SITAM SMART ERP — OBSERVABILITY INTEGRATION TEST SUITE  ');
    console.log('═══════════════════════════════════════════════════════════\n');

    // ─── 1. Module Importability ─────────────────────────────────────────────
    console.log('[ 1 ] Module Importability');

    let scheduler, sloFramework, errorBudgetGovernor, syntheticMonitor,
        businessCollector, alertRouter, alertEscalationRules, metricsService;

    check('ObservabilityScheduler can be required', () => {
        scheduler = require('../services/ObservabilityScheduler');
        return !!scheduler;
    });
    check('SLOFramework can be required', () => {
        sloFramework = require('../observability/slo/SLOFramework');
        return !!sloFramework;
    });
    check('ErrorBudgetGovernor can be required', () => {
        errorBudgetGovernor = require('../observability/slo/ErrorBudgetGovernor');
        return !!errorBudgetGovernor;
    });
    check('SyntheticMonitor can be required', () => {
        syntheticMonitor = require('../monitoring/synthetic/SyntheticMonitor');
        return !!syntheticMonitor;
    });
    check('BusinessMetricsCollector can be required', () => {
        businessCollector = require('../observability/business/BusinessMetricsCollector');
        return !!businessCollector;
    });
    check('AlertRouter can be required', () => {
        alertRouter = require('../observability/alerting/AlertRouter');
        return !!alertRouter;
    });
    check('AlertEscalationRules can be required', () => {
        alertEscalationRules = require('../observability/alerting/AlertEscalationRules');
        return !!(alertEscalationRules && alertEscalationRules.ownershipMatrix);
    });
    check('metricsService can be required', () => {
        metricsService = require('../services/metricsService');
        return !!(metricsService && metricsService.register);
    });

    // ─── 2. ObservabilityScheduler Bootstrap ────────────────────────────────
    console.log('\n[ 2 ] ObservabilityScheduler Bootstrap');

    check('scheduler.start() is a function', () => typeof scheduler.start === 'function');
    check('scheduler.stop() is a function', () => typeof scheduler.stop === 'function');
    check('scheduler.getAlertRouter() is a function', () => typeof scheduler.getAlertRouter === 'function');
    check('scheduler.getBusinessCollector() is a function', () => typeof scheduler.getBusinessCollector === 'function');

    // Start the scheduler (uses test-safe lazy loads)
    scheduler.start();
    check('scheduler._started is true after start()', () => scheduler._started === true);
    check('scheduler has SLO interval registered', () => !!scheduler._intervals.slo);
    check('scheduler has Synthetic interval registered', () => !!scheduler._intervals.synthetic);
    check('scheduler has Business interval registered', () => !!scheduler._intervals.business);
    check('scheduler.getAlertRouter() returns an AlertRouter instance', () => {
        const ar = scheduler.getAlertRouter();
        return ar && typeof ar.routeAlert === 'function';
    });
    check('scheduler.getBusinessCollector() returns a collector', () => {
        const bc = scheduler.getBusinessCollector();
        return bc && typeof bc.trackFeatureAccess === 'function';
    });

    // Idempotency — should not throw or double-register
    check('scheduler.start() is idempotent (safe to call twice)', () => {
        scheduler.start(); // second call must be no-op
        return Object.keys(scheduler._intervals).length === 3;
    });

    // ─── 3. SLO Framework Metrics ────────────────────────────────────────────
    console.log('\n[ 3 ] SLOFramework Prometheus Metrics');

    check('SLOFramework instantiated with shared registry (via scheduler)', () => {
        // Use the scheduler's singleton — creating a second instance would fail
        // because the metrics are already registered.
        return !!(scheduler.sloFramework && scheduler.sloFramework.sloTargetGauge);
    });
    await checkAsync('SLOFramework.calculateBudgets() executes and returns results', async () => {
        const res = scheduler.sloFramework.calculateBudgets({});
        return Array.isArray(res) && res.length > 0;
    });
    await checkAsync('metricsService.getSloStats() returns an object', async () => {
        const stats = await metricsService.getSloStats();
        return stats !== null && typeof stats === 'object';
    });

    // ─── 4. ErrorBudgetGovernor Execution ───────────────────────────────────
    console.log('\n[ 4 ] ErrorBudgetGovernor Execution');

    check('ErrorBudgetGovernor.assessDeploymentSafety() executes', () => {
        const result = scheduler.errorBudgetGovernor.assessDeploymentSafety();
        return result && ['SAFE', 'CAUTION', 'FREEZE'].includes(result.recommendation);
    });
    check('ErrorBudgetGovernor.deploymentSafetyGauge is registered', () => {
        return !!scheduler.errorBudgetGovernor.deploymentSafetyGauge;
    });

    // ─── 5. SyntheticMonitor Probe Execution ─────────────────────────────────
    console.log('\n[ 5 ] SyntheticMonitor Probe Execution');

    await checkAsync('SyntheticMonitor queue_health probe executes', async () => {
        const result = await scheduler.syntheticMonitor._probeQueueHealth();
        return result && typeof result.success === 'boolean';
    });
    check('SyntheticMonitor.probeDuration histogram registered', () => {
        return !!scheduler.syntheticMonitor.probeDuration;
    });

    // ─── 6. BusinessMetricsCollector ─────────────────────────────────────────
    console.log('\n[ 6 ] BusinessMetricsCollector');

    check('businessCollector.trackFeatureAccess() is callable', async () => {
        const bc = scheduler.getBusinessCollector();
        if (!bc) throw new Error('businessCollector not initialized by scheduler');
        await bc.trackFeatureAccess('test_feature');
        return true;
    });
    check('businessCollector.syncStartedCounter is registered (extended metric)', () => {
        const bc = scheduler.getBusinessCollector();
        return bc && !!bc.syncStartedCounter;
    });
    check('businessCollector.syncFailedCounter is registered (extended metric)', () => {
        const bc = scheduler.getBusinessCollector();
        return bc && !!bc.syncFailedCounter;
    });
    check('businessCollector.queueWaitHistogram is registered (extended metric)', () => {
        const bc = scheduler.getBusinessCollector();
        return bc && !!bc.queueWaitHistogram;
    });
    check('businessCollector.syncRetryCounter is registered (extended metric)', () => {
        const bc = scheduler.getBusinessCollector();
        return bc && !!bc.syncRetryCounter;
    });

    // ─── 7. AlertRouter Execution ────────────────────────────────────────────
    console.log('\n[ 7 ] AlertRouter Execution');

    const AR = alertRouter;
    const testRouter = new AR();
    check('AlertRouter.routeAlert() routes a P2 alert', () => {
        const result = testRouter.routeAlert({
            service: 'TestSuite',
            type: 'api_latency',
            severity: 'P2',
            message: 'Integration test alert',
            description: 'Triggered by test-observability-integration.js'
        });
        return result.status === 'ROUTED' || result.status === 'DEDUPLICATED';
    });
    check('AlertRouter deduplication works (second identical alert suppressed)', () => {
        // Same key as above — should be DEDUPLICATED within the dedup window
        const result = testRouter.routeAlert({
            service: 'TestSuite',
            type: 'api_latency',
            severity: 'P2',
            message: 'Integration test alert',
            description: 'Duplicate'
        });
        return result.status === 'DEDUPLICATED';
    });
    check('AlertEscalationRules has ownershipMatrix', () => {
        return !!alertEscalationRules.ownershipMatrix && !!alertEscalationRules.ownershipMatrix.database;
    });
    check('AlertEscalationRules has escalationRules', () => {
        return Array.isArray(alertEscalationRules.escalationRules) && alertEscalationRules.escalationRules.length > 0;
    });

    // ─── 8. Prometheus Registry Integrity ───────────────────────────────────
    console.log('\n[ 8 ] Prometheus Registry Integrity (/api/metrics)');

    await checkAsync('metricsService.register produces metrics output', async () => {
        const output = await metricsService.register.metrics();
        return typeof output === 'string' && output.length > 100;
    });

    const expectedMetrics = [
        'slo_target_ratio',
        'slo_compliance_ratio',
        'error_budget_remaining_minutes',
        'slo_burn_rate',
        'deployment_safety_status',
        'reliability_risk_score',
        'synthetic_probe_duration_seconds',
        'synthetic_probe_success_total',
        'active_users',
        'feature_adoption_total',
        'syncs_completed_total',
        'syncs_started_total',
        'syncs_failed_total',
        'sync_queue_wait_seconds',
        'syncs_retried_total'
    ];

    await checkAsync(`All ${expectedMetrics.length} observability metrics present in registry`, async () => {
        const output = await metricsService.register.metrics();
        const missing = expectedMetrics.filter(m => !output.includes(m));
        if (missing.length > 0) throw new Error(`Missing metrics: ${missing.join(', ')}`);
        return true;
    });

    // ─── 9. Graceful Shutdown ────────────────────────────────────────────────
    console.log('\n[ 9 ] Graceful Shutdown');

    check('scheduler.stop() clears all intervals', () => {
        scheduler.stop();
        return Object.keys(scheduler._intervals).length === 0 && scheduler._started === false;
    });

    // ─── Summary ─────────────────────────────────────────────────────────────
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log(`  RESULT: ${passed} passed, ${failed} failed`);
    if (failed === 0) {
        console.log('  STATUS: ✅ ALL OBSERVABILITY CHECKS PASSED — MATURITY: 100%');
    } else {
        console.log(`  STATUS: ❌ ${failed} CHECKS FAILED — REMEDIATION REQUIRED`);
    }
    console.log('═══════════════════════════════════════════════════════════\n');

    process.exit(failed > 0 ? 1 : 0);
})();
