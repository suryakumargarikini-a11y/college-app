#!/usr/bin/env node
'use strict';

/**
 * scripts/test-observability-dashboard-data.js
 * SITAM Smart ERP — Grafana Dashboard Metrics Validator
 *
 * Validates that every metric referenced in Grafana dashboard panels
 * is actually registered and exposed on the /api/metrics Prometheus endpoint.
 *
 * This script loads the shared metricsService registry directly (no HTTP server
 * needed) and checks for the presence of all expected metric names.
 *
 * Usage:
 *   node scripts/test-observability-dashboard-data.js
 *
 * Exit code 0 = all dashboard metrics are present
 * Exit code 1 = one or more metrics are missing
 */

process.env.NODE_ENV = 'test';
require('dotenv').config();

// ─── Dashboard Metric Inventory ───────────────────────────────────────────────
// These are the metric names that Grafana dashboards query.
// Grouped by panel/dashboard category for readability.

const DASHBOARD_METRICS = [
    // Node.js process (default metrics — always present)
    { group: 'Node.js Runtime',        name: 'node_process_cpu_seconds_total' },
    { group: 'Node.js Runtime',        name: 'node_process_resident_memory_bytes' },

    // HTTP API
    { group: 'HTTP',                   name: 'http_requests_total' },
    { group: 'HTTP',                   name: 'http_request_duration_seconds' },
    { group: 'HTTP',                   name: 'active_http_requests' },
    { group: 'HTTP',                   name: 'http_slow_requests_total' },

    // Redis
    { group: 'Redis',                  name: 'redis_connected' },
    { group: 'Redis',                  name: 'redis_reconnect_total' },
    { group: 'Redis',                  name: 'redis_command_duration_seconds' },

    // BullMQ Queue
    { group: 'Queue',                  name: 'bullmq_jobs_waiting' },
    { group: 'Queue',                  name: 'bullmq_jobs_active' },
    { group: 'Queue',                  name: 'bullmq_jobs_failed_total' },
    { group: 'Queue',                  name: 'bullmq_jobs_completed_total' },
    { group: 'Queue',                  name: 'bullmq_queue_latency_seconds' },

    // Browser Pool
    { group: 'Browser Pool',           name: 'browser_pool_active_browsers' },
    { group: 'Browser Pool',           name: 'browser_pool_active_contexts' },
    { group: 'Browser Pool',           name: 'browser_crashes_total' },
    { group: 'Browser Pool',           name: 'browser_pool_recycle_total' },
    { group: 'Browser Pool',           name: 'browser_pool_timeouts_total' },

    // Sync
    { group: 'Sync',                   name: 'sync_duration_seconds' },

    // PostgreSQL
    { group: 'PostgreSQL',             name: 'postgres_pool_active_connections' },
    { group: 'PostgreSQL',             name: 'postgres_query_duration_seconds' },
    { group: 'PostgreSQL',             name: 'postgres_slow_queries_total' },

    // WebSocket
    { group: 'WebSocket',              name: 'websocket_connections_active' },
    { group: 'WebSocket',              name: 'websocket_messages_total' },

    // Circuit Breaker
    { group: 'Circuit Breaker',        name: 'circuit_breaker_state' },
    { group: 'Circuit Breaker',        name: 'circuit_breaker_failures_total' },

    // Workers
    { group: 'Workers',                name: 'workers_active' },
    { group: 'Workers',                name: 'worker_job_duration_seconds' },

    // SLO / Error Budget (NEW — from ObservabilityScheduler)
    { group: 'SLO',                    name: 'slo_target_ratio' },
    { group: 'SLO',                    name: 'slo_compliance_ratio' },
    { group: 'SLO',                    name: 'error_budget_remaining_minutes' },
    { group: 'SLO',                    name: 'slo_burn_rate' },
    { group: 'SLO',                    name: 'deployment_safety_status' },
    { group: 'SLO',                    name: 'reliability_risk_score' },

    // Synthetic Monitoring (NEW)
    { group: 'Synthetic',              name: 'synthetic_probe_duration_seconds' },
    { group: 'Synthetic',              name: 'synthetic_probe_success_total' },
    { group: 'Synthetic',              name: 'synthetic_probe_failure_total' },

    // Business Metrics (NEW)
    { group: 'Business',               name: 'active_users' },
    { group: 'Business',               name: 'feature_adoption_total' },
    { group: 'Business',               name: 'syncs_completed_total' },
    { group: 'Business',               name: 'syncs_started_total' },
    { group: 'Business',               name: 'syncs_failed_total' },
    { group: 'Business',               name: 'business_sync_duration_seconds' },
    { group: 'Business',               name: 'sync_queue_wait_seconds' },
    { group: 'Business',               name: 'syncs_retried_total' },
];

(async () => {
    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log('  SITAM SMART ERP — GRAFANA DASHBOARD METRICS VALIDATOR');
    console.log('═══════════════════════════════════════════════════════════════\n');

    // 1. Bootstrap the ObservabilityScheduler so all metric gauges are registered
    let metricsOutput;
    try {
        const scheduler = require('../services/ObservabilityScheduler');
        scheduler.start(); // registers all Prometheus metrics
        const metricsService = require('../services/metricsService');
        metricsOutput = await metricsService.register.metrics();
        scheduler.stop(); // clean up intervals
    } catch (err) {
        console.error(`FATAL: Could not load metricsService/ObservabilityScheduler: ${err.message}`);
        process.exit(1);
    }

    // 2. Check each expected metric against the registry output
    let passed = 0;
    let failed = 0;
    let lastGroup = null;

    for (const { group, name } of DASHBOARD_METRICS) {
        if (group !== lastGroup) {
            console.log(`  ── ${group} ──`);
            lastGroup = group;
        }

        // In Prometheus text format, metric names appear as "# HELP <name>" or "<name>{" or "<name> "
        const present = metricsOutput.includes(`# HELP ${name}`) ||
                        metricsOutput.includes(`${name}{`) ||
                        metricsOutput.includes(`${name} `);

        if (present) {
            console.log(`    ✓  ${name}`);
            passed++;
        } else {
            console.log(`    ✗  ${name}  ← MISSING from /api/metrics`);
            failed++;
        }
    }

    // 3. Summary
    const total = DASHBOARD_METRICS.length;
    const coverage = Math.round((passed / total) * 100);

    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log(`  Total Metrics Checked : ${total}`);
    console.log(`  Present in Registry   : ${passed}`);
    console.log(`  Missing               : ${failed}`);
    console.log(`  Dashboard Coverage    : ${coverage}%`);
    if (failed === 0) {
        console.log('  Status                : ✅ ALL DASHBOARD METRICS POPULATED');
    } else {
        console.log('  Status                : ❌ MISSING METRICS — Grafana panels will show "No data"');
    }
    console.log('═══════════════════════════════════════════════════════════════\n');

    process.exit(failed > 0 ? 1 : 0);
})();
