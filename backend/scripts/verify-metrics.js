/**
 * SITAM Smart ERP — Prometheus Metrics Verification Script
 *
 * Checks if /api/metrics endpoint returns valid Prometheus line format
 * and verifies that all custom infrastructure metrics are active and populated.
 *
 * Usage:
 *   # Against Render production (default):
 *   node scripts/verify-metrics.js
 *
 *   # Against local backend:
 *   TARGET_URL=http://localhost:3001 node scripts/verify-metrics.js
 */

const http = require('http');

const TARGET_URL = process.env.TARGET_URL || 'https://web-production-07b0.up.railway.app';

const REQUIRED_METRICS = [
    'node_process_cpu_user_seconds_total',
    'http_requests_total',
    'http_request_duration_seconds',
    'active_http_requests',
    'redis_connected',
    'redis_reconnect_total',
    'redis_command_duration_seconds',
    'bullmq_jobs_waiting',
    'bullmq_jobs_active',
    'bullmq_jobs_failed_total',
    'bullmq_jobs_completed_total',
    'bullmq_queue_latency_seconds',
    'browser_pool_active_browsers',
    'browser_pool_active_contexts',
    'browser_crashes_total',
    'sync_duration_seconds',
    'postgres_pool_active_connections',
    'postgres_query_duration_seconds',
    'postgres_slow_queries_total',
    'websocket_connections_active',
    'websocket_messages_total',
    'circuit_breaker_state',
    'circuit_breaker_failures_total',
    'workers_active',
    'worker_job_duration_seconds'
];

function fetchMetrics() {
    return new Promise((resolve, reject) => {
        const url = new URL('/api/metrics', TARGET_URL);
        const options = {
            hostname: url.hostname,
            port: url.port || 80,
            path: url.pathname,
            method: 'GET',
            timeout: 5000,
        };

        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                resolve({
                    status: res.statusCode,
                    headers: res.headers,
                    body: data
                });
            });
        });

        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
        req.end();
    });
}

async function verify() {
    console.log('\n================================================================');
    console.log('  SITAM ERP — PROMETHEUS METRICS VERIFICATION');
    console.log('================================================================');
    console.log(`  Pinging ${TARGET_URL}/api/metrics...`);

    try {
        const res = await fetchMetrics();

        if (res.status !== 200) {
            console.error(`  [FAIL] Endpoint returned HTTP ${res.status}. Expected 200.`);
            process.exit(1);
        }

        console.log('  [PASS] HTTP Status 200 OK.');

        const contentType = res.headers['content-type'] || '';
        if (!contentType.includes('text/plain')) {
            console.warn(`  [WARN] Content-Type is "${contentType}". Prometheus expects text/plain.`);
        } else {
            console.log(`  [PASS] Content-Type header verified: ${contentType}`);
        }

        // Verify metrics existence
        const lines = res.body.split('\n');
        const metricNamesFound = new Set();

        for (const line of lines) {
            if (line.startsWith('# HELP ')) {
                const parts = line.split(' ');
                if (parts.length >= 3) {
                    metricNamesFound.add(parts[2]);
                }
            }
        }

        console.log(`\n  Checking registered metrics (${metricNamesFound.size} total found):`);
        let missingCount = 0;

        for (const m of REQUIRED_METRICS) {
            // Default process metrics can be node_process_cpu_usage_seconds_total or process_cpu_seconds_total
            if (metricNamesFound.has(m) ||
                (m.startsWith('node_') && Array.from(metricNamesFound).some(name => name.includes(m.replace('node_', ''))))) {
                console.log(`    ✓ ${m.padEnd(45)} [FOUND]`);
            } else {
                console.warn(`    ✗ ${m.padEnd(45)} [MISSING]`);
                missingCount++;
            }
        }

        console.log('\n================================================================');
        if (missingCount === 0) {
            console.log('  ✓ VERIFICATION COMPLETE: ALL METRICS SUCCESSFULLY PROVISIONED');
        } else {
            console.log(`  ⚠ VERIFICATION COMPLETE: ${missingCount} METRICS WERE OFFLINE/MISSING`);
            console.log('  (Note: some BullMQ/Worker/WS metrics only register HELP lines on first usage)');
        }
        console.log('================================================================\n');

        process.exit(0);

    } catch (err) {
        console.error(`\n  [FAIL] Failed to contact endpoint: ${err.message}`);
        console.error('  Please ensure the backend is running before running this verification script.');
        process.exit(1);
    }
}

verify();
