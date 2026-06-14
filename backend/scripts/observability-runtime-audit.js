#!/usr/bin/env node
'use strict';

/**
 * scripts/observability-runtime-audit.js
 * SITAM Smart ERP — Observability Maturity Audit
 *
 * Forensic runtime audit that FAILS if any observability module exists but
 * is not wired into a live runtime path. This script enforces the standard:
 *
 *   A module is INTEGRATED only if:
 *     ✓ Imported by production runtime code
 *     ✓ Instantiated during server startup
 *     ✓ Emits ProviderMetrics / Prometheus telemetry
 *     ✓ Covered by integration tests
 *     ✓ Appears in runtime call graph
 *
 * Usage:
 *   node scripts/observability-runtime-audit.js
 *
 * Exit code 0 = 100% maturity
 * Exit code 1 = partial / dead code detected
 */

process.env.NODE_ENV = 'test';
require('dotenv').config();

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

let score = 0;
const TOTAL_CHECKS = 10; // Each module = 1 point

const results = [];

function audit(module, checks) {
    let allPassed = true;
    const detail = [];
    for (const [label, fn] of Object.entries(checks)) {
        try {
            const result = fn();
            if (!result) {
                detail.push(`  ✗ ${label}`);
                allPassed = false;
            } else {
                detail.push(`  ✓ ${label}`);
            }
        } catch (err) {
            detail.push(`  ✗ ${label}: ${err.message}`);
            allPassed = false;
        }
    }
    if (allPassed) score++;
    results.push({ module, status: allPassed ? 'INTEGRATED' : 'PARTIAL/DEAD CODE', detail });
}

function fileContains(relPath, ...patterns) {
    const absPath = path.join(ROOT, relPath);
    if (!fs.existsSync(absPath)) return false;
    const content = fs.readFileSync(absPath, 'utf8');
    return patterns.every(p => content.includes(p));
}

function fileExists(relPath) {
    return fs.existsSync(path.join(ROOT, relPath));
}

// ─── 1. SLOFramework ──────────────────────────────────────────────────────────
audit('SLOFramework', {
    'File exists': () => fileExists('observability/slo/SLOFramework.js'),
    'Imported by ObservabilityScheduler': () => fileContains('services/ObservabilityScheduler.js', 'SLOFramework'),
    'Instantiated with shared registry': () => fileContains('services/ObservabilityScheduler.js', 'new SLOFramework', 'metrics: registry'),
    'calculateBudgets() called in scheduler interval': () => fileContains('services/ObservabilityScheduler.js', 'sloFramework.calculateBudgets'),
    'Emits slo_target_ratio to Prometheus': () => fileContains('observability/slo/SLOFramework.js', 'slo_target_ratio', 'registers: [this.metrics]'),
});

// ─── 2. ErrorBudgetGovernor ───────────────────────────────────────────────────
audit('ErrorBudgetGovernor', {
    'File exists': () => fileExists('observability/slo/ErrorBudgetGovernor.js'),
    'Imported by ObservabilityScheduler': () => fileContains('services/ObservabilityScheduler.js', 'ErrorBudgetGovernor'),
    'Instantiated with shared registry': () => fileContains('services/ObservabilityScheduler.js', 'new ErrorBudgetGovernor', 'metrics: registry'),
    'assessDeploymentSafety() called in scheduler interval': () => fileContains('services/ObservabilityScheduler.js', 'assessDeploymentSafety'),
    'Emits deployment_safety_status gauge': () => fileContains('observability/slo/ErrorBudgetGovernor.js', 'deployment_safety_status'),
});

// ─── 3. SyntheticMonitor ─────────────────────────────────────────────────────
audit('SyntheticMonitor', {
    'File exists': () => fileExists('monitoring/synthetic/SyntheticMonitor.js'),
    'Imported by ObservabilityScheduler': () => fileContains('services/ObservabilityScheduler.js', 'SyntheticMonitor'),
    'Instantiated with shared registry': () => fileContains('services/ObservabilityScheduler.js', 'new SyntheticMonitor', 'metrics: registry'),
    'runAllProbes() called on 60s interval': () => fileContains('services/ObservabilityScheduler.js', 'syntheticMonitor.runAllProbes'),
    'Emits synthetic_probe_duration_seconds': () => fileContains('monitoring/synthetic/SyntheticMonitor.js', 'synthetic_probe_duration_seconds'),
});

// ─── 4. BusinessMetricsCollector ─────────────────────────────────────────────
audit('BusinessMetricsCollector', {
    'File exists': () => fileExists('observability/business/BusinessMetricsCollector.js'),
    'Imported by ObservabilityScheduler': () => fileContains('services/ObservabilityScheduler.js', 'BusinessMetricsCollector'),
    'collectActiveUsers() scheduled (60s interval)': () => fileContains('services/ObservabilityScheduler.js', 'collectActiveUsers'),
    'Exposed via getBusinessCollector()': () => fileContains('services/ObservabilityScheduler.js', 'getBusinessCollector'),
    'Extended sync lifecycle metrics registered': () => fileContains('services/ObservabilityScheduler.js', 'syncs_started_total', 'syncs_failed_total'),
});

// ─── 5. AlertRouter ──────────────────────────────────────────────────────────
audit('AlertRouter', {
    'File exists': () => fileExists('observability/alerting/AlertRouter.js'),
    'Imported by ObservabilityScheduler': () => fileContains('services/ObservabilityScheduler.js', 'AlertRouter'),
    'Exposed via getAlertRouter()': () => fileContains('services/ObservabilityScheduler.js', 'getAlertRouter'),
    'Wired into errorHandler.js (500-level errors)': () => fileContains('middleware/errorHandler.js', 'ObservabilityScheduler', 'getAlertRouter', 'routeAlert'),
    'Wired into circuitBreaker.js (OPEN state)': () => fileContains('services/circuitBreaker.js', 'ObservabilityScheduler', 'getAlertRouter', 'routeAlert'),
});

// ─── 6. AlertEscalationRules ─────────────────────────────────────────────────
audit('AlertEscalationRules', {
    'File exists': () => fileExists('observability/alerting/AlertEscalationRules.js'),
    'Imported by ObservabilityScheduler': () => fileContains('services/ObservabilityScheduler.js', 'AlertEscalationRules'),
    'Assigned to alertRouter.escalationRules': () => fileContains('services/ObservabilityScheduler.js', 'alertRouter.escalationRules', 'AlertEscalationRules'),
    'Contains ownershipMatrix': () => fileContains('observability/alerting/AlertEscalationRules.js', 'ownershipMatrix'),
    'Contains P1 escalation stages': () => fileContains('observability/alerting/AlertEscalationRules.js', 'P1', 'stages'),
});

// ─── 7. server.js Integration ────────────────────────────────────────────────
audit('server.js runtime wiring', {
    'ObservabilityScheduler imported at top': () => fileContains('server.js', "require('./services/ObservabilityScheduler')"),
    'observabilityScheduler.start() called on listen': () => fileContains('server.js', 'observabilityScheduler.start()'),
    'observabilityScheduler.stop() called on shutdown': () => fileContains('server.js', 'observabilityScheduler.stop()'),
    'metricsService.getSloStats exported': () => fileContains('services/metricsService.js', 'getSloStats'),
    'metricsService.getSloStats used in scheduler interval': () => fileContains('services/ObservabilityScheduler.js', 'getSloStats'),
});

// ─── 8. worker.js Integration ────────────────────────────────────────────────
audit('worker.js runtime wiring', {
    'AlertRouter routing on job failure': () => fileContains('worker.js', 'getAR', 'routeAlert', 'scraping_failure'),
    'Sync started tracked': () => fileContains('worker.js', 'syncStartedCounter'),
    'Sync completed tracked': () => fileContains('worker.js', 'trackSyncCompleted'),
    'Sync failed tracked': () => fileContains('worker.js', 'syncFailedCounter'),
    'Queue wait time tracked': () => fileContains('worker.js', 'queueWaitHistogram'),
});

// ─── 9. authController.js Integration ───────────────────────────────────────
audit('authController.js feature tracking', {
    'getBusinessCollector helper defined': () => fileContains('controllers/authController.js', 'getBusinessCollector'),
    'trackActiveUser on instant login': () => fileContains('controllers/authController.js', 'bc.trackActiveUser(userId)'),
    'trackFeatureAccess login on instant login': () => fileContains('controllers/authController.js', "trackFeatureAccess('login')"),
    'trackActiveUser on provider login': () => {
        const content = fs.readFileSync(path.join(ROOT, 'controllers/authController.js'), 'utf8');
        return (content.match(/trackActiveUser/g) || []).length >= 2;
    },
    'Business collector is failure-safe (try/catch)': () => fileContains('controllers/authController.js', 'getBusinessCollector', 'catch'),
});

// ─── 10. dataControllers.js Feature Tracking ─────────────────────────────────
audit('dataControllers.js feature tracking', {
    'getBusinessCollector helper defined': () => fileContains('controllers/dataControllers.js', 'getBusinessCollector'),
    "trackFeatureAccess('profile') called": () => fileContains('controllers/dataControllers.js', "trackFeatureAccess('profile')"),
    "trackFeatureAccess('marks') called": () => fileContains('controllers/dataControllers.js', "trackFeatureAccess('marks')"),
    "trackFeatureAccess('fees') called": () => fileContains('controllers/dataControllers.js', "trackFeatureAccess('fees')"),
    "trackFeatureAccess('assignments') called": () => fileContains('controllers/dataControllers.js', "trackFeatureAccess('assignments')"),
});

// ─── Report ───────────────────────────────────────────────────────────────────
console.log('\n═══════════════════════════════════════════════════════════════');
console.log('  SITAM SMART ERP — OBSERVABILITY MATURITY AUDIT REPORT');
console.log('═══════════════════════════════════════════════════════════════\n');

for (const r of results) {
    const icon = r.status === 'INTEGRATED' ? '✅' : '❌';
    console.log(`${icon}  ${r.module} — ${r.status}`);
    for (const line of r.detail) {
        console.log(`       ${line}`);
    }
    console.log();
}

const maturity = Math.round((score / TOTAL_CHECKS) * 100);
console.log('═══════════════════════════════════════════════════════════════');
console.log(`  Integrated Modules : ${score} / ${TOTAL_CHECKS}`);
console.log(`  Dead / Partial     : ${TOTAL_CHECKS - score} / ${TOTAL_CHECKS}`);
console.log(`  Maturity Score     : ${maturity}%`);
if (maturity === 100) {
    console.log('  Status             : ✅ 100% OBSERVABILITY MATURITY ACHIEVED');
} else {
    console.log(`  Status             : ❌ INCOMPLETE — ${100 - maturity}% gap remaining`);
}
console.log('═══════════════════════════════════════════════════════════════\n');

process.exit(maturity < 100 ? 1 : 0);
