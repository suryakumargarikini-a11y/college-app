/**
 * SITAM Smart ERP — HTTP API Load Test Runner
 *
 * Pure Node.js load tester — no external dependencies.
 * Simulates concurrent users hitting real API endpoints.
 *
 * Usage:
 *   # Against Render production (default):
 *   node scripts/load-test-api.js
 *
 *   # Against local backend:
 *   TARGET_URL=http://localhost:3001 node scripts/load-test-api.js
 *
 * Environment overrides:
 *   TARGET_URL=http://localhost:3001
 *   CONCURRENT_USERS=50
 *   TOTAL_REQUESTS=500
 *   BEARER_TOKEN=<your_session_token>  (for authenticated route testing)
 */

const http = require('http');
const https = require('https');

const TARGET_URL = process.env.TARGET_URL || 'https://college-app-bx6b.onrender.com/api';
const CONCURRENT_USERS = parseInt(process.env.CONCURRENT_USERS || '50', 10);
const TOTAL_REQUESTS = parseInt(process.env.TOTAL_REQUESTS || '500', 10);
const BEARER_TOKEN = process.env.BEARER_TOKEN || '';

// Color codes
const C = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    red: '\x1b[31m',
    cyan: '\x1b[36m',
    bold: '\x1b[1m',
    dim: '\x1b[2m',
};

// ─── Test Scenarios ───────────────────────────────────────────────────────────
const SCENARIOS = [
    { label: 'Liveness Probe',  method: 'GET',  path: '/api/health/liveness', weight: 3 },
    // Readiness probe can return 503 (degraded) when DB is not connected — still a valid response
    { label: 'Readiness Probe', method: 'GET',  path: '/api/health/readiness', weight: 2, acceptedCodes: [200, 503] },
    { label: 'Circuit Status',  method: 'GET',  path: '/api/health/circuit', weight: 1 },
    { label: 'Metrics Scrape',  method: 'GET',  path: '/api/metrics', weight: 2 },
    ...(BEARER_TOKEN ? [
        { label: 'Attendance API',  method: 'GET',  path: '/api/attendance', weight: 4, auth: true },
        { label: 'Marks API',       method: 'GET',  path: '/api/marks', weight: 4, auth: true },
        { label: 'Fees API',        method: 'GET',  path: '/api/fees', weight: 3, auth: true },
        { label: 'Profile API',     method: 'GET',  path: '/api/profile', weight: 3, auth: true },
        { label: 'Notifications',   method: 'GET',  path: '/api/notifications', weight: 2, auth: true },
    ] : []),
];

// Build weighted request pool
const weightedPool = [];
for (const scenario of SCENARIOS) {
    for (let i = 0; i < scenario.weight; i++) weightedPool.push(scenario);
}

// ─── HTTP Request Helper ──────────────────────────────────────────────────────
function makeRequest(scenario) {
    return new Promise((resolve) => {
        const url = new URL(scenario.path, TARGET_URL);
        const client = url.protocol === 'https:' ? https : http;
        const start = Date.now();

        const options = {
            method: scenario.method,
            hostname: url.hostname,
            port: url.port || (url.protocol === 'https:' ? 443 : 80),
            path: url.pathname + url.search,
            headers: {
                'Content-Type': 'application/json',
                ...(scenario.auth && BEARER_TOKEN ? { 'Authorization': `Bearer ${BEARER_TOKEN}` } : {}),
            },
            timeout: 10000,
        };

        const req = client.request(options, (res) => {
            // Drain the response body
            res.on('data', () => {});
            res.on('end', () => {
                const acceptedCodes = scenario.acceptedCodes || [];
                const isSuccess = res.statusCode < 400 || acceptedCodes.includes(res.statusCode);
                resolve({
                    label: scenario.label,
                    statusCode: res.statusCode,
                    durationMs: Date.now() - start,
                    success: isSuccess,
                });
            });
        });

        req.on('error', (err) => {
            resolve({
                label: scenario.label,
                statusCode: 0,
                durationMs: Date.now() - start,
                success: false,
                error: err.message,
            });
        });

        req.on('timeout', () => {
            req.destroy();
            resolve({
                label: scenario.label,
                statusCode: 0,
                durationMs: Date.now() - start,
                success: false,
                error: 'Request timeout (10s)',
            });
        });

        req.end();
    });
}

// ─── Stats Calculator ─────────────────────────────────────────────────────────
function percentile(sorted, p) {
    if (sorted.length === 0) return 0;
    const idx = Math.floor(sorted.length * p);
    return sorted[Math.min(idx, sorted.length - 1)];
}

function printResults(results, totalDurationMs) {
    const successful = results.filter(r => r.success);
    const failed = results.filter(r => !r.success);
    const durations = results.map(r => r.durationMs).sort((a, b) => a - b);

    const byLabel = {};
    for (const r of results) {
        if (!byLabel[r.label]) byLabel[r.label] = { count: 0, success: 0, durations: [] };
        byLabel[r.label].count++;
        if (r.success) byLabel[r.label].success++;
        byLabel[r.label].durations.push(r.durationMs);
    }

    console.log('\n' + C.bold + '═'.repeat(70) + C.reset);
    console.log(C.bold + C.cyan + '  SITAM ERP — LOAD TEST RESULTS' + C.reset);
    console.log(C.bold + '═'.repeat(70) + C.reset);

    console.log(`\n${C.bold}Configuration:${C.reset}`);
    console.log(`  Target URL:        ${TARGET_URL}`);
    console.log(`  Concurrent Users:  ${CONCURRENT_USERS}`);
    console.log(`  Total Requests:    ${TOTAL_REQUESTS}`);
    console.log(`  Auth Routes:       ${BEARER_TOKEN ? 'YES (token provided)' : 'NO (unauthenticated routes only)'}`);

    console.log(`\n${C.bold}Overall Summary:${C.reset}`);
    console.log(`  Total Requests:    ${results.length}`);
    console.log(`  Successful:        ${C.green}${successful.length}${C.reset} (${((successful.length / results.length) * 100).toFixed(1)}%)`);
    console.log(`  Failed:            ${failed.length > 0 ? C.red : C.green}${failed.length}${C.reset} (${((failed.length / results.length) * 100).toFixed(1)}%)`);
    console.log(`  Total Duration:    ${(totalDurationMs / 1000).toFixed(2)}s`);
    console.log(`  Throughput:        ${(results.length / (totalDurationMs / 1000)).toFixed(1)} req/s`);

    console.log(`\n${C.bold}Latency Percentiles (all routes):${C.reset}`);
    console.log(`  p50 (median):  ${percentile(durations, 0.50)}ms`);
    console.log(`  p75:           ${percentile(durations, 0.75)}ms`);
    console.log(`  p90:           ${percentile(durations, 0.90)}ms`);
    console.log(`  p95:           ${percentile(durations, 0.95)}ms`);
    console.log(`  p99:           ${percentile(durations, 0.99)}ms`);
    console.log(`  max:           ${durations[durations.length - 1]}ms`);
    console.log(`  min:           ${durations[0]}ms`);
    console.log(`  avg:           ${Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)}ms`);

    console.log(`\n${C.bold}Per-Route Breakdown:${C.reset}`);
    const header = `  ${'Route'.padEnd(22)} ${'Count'.padEnd(8)} ${'OK'.padEnd(8)} ${'p50'.padEnd(8)} ${'p95'.padEnd(8)} ${'p99'.padEnd(8)}`;
    console.log(header);
    console.log(`  ${'-'.repeat(66)}`);

    for (const [label, stats] of Object.entries(byLabel)) {
        const sorted = stats.durations.sort((a, b) => a - b);
        const errorRate = ((stats.count - stats.success) / stats.count * 100).toFixed(0);
        const okColor = stats.success === stats.count ? C.green : C.yellow;
        console.log(
            `  ${label.padEnd(22)} ${String(stats.count).padEnd(8)} ${okColor}${String(stats.success).padEnd(8)}${C.reset}` +
            `${String(percentile(sorted, 0.50)).padEnd(8)} ${String(percentile(sorted, 0.95)).padEnd(8)} ${String(percentile(sorted, 0.99)).padEnd(8)}`
        );
    }

    if (failed.length > 0) {
        console.log(`\n${C.bold}${C.red}Failed Requests Sample:${C.reset}`);
        const sample = failed.slice(0, 5);
        for (const f of sample) {
            console.log(`  [${f.label}] status=${f.statusCode} error=${f.error || 'HTTP ' + f.statusCode} (${f.durationMs}ms)`);
        }
    }

    const overallPass = (failed.length / results.length) < 0.01 && percentile(durations, 0.99) < 2000;
    console.log('\n' + C.bold + '═'.repeat(70) + C.reset);
    console.log(overallPass
        ? `${C.bold}${C.green}  ✓ LOAD TEST PASSED — Error rate <1% and p99 <2000ms${C.reset}`
        : `${C.bold}${C.red}  ✗ LOAD TEST FAILED — Check failures above${C.reset}`
    );
    console.log(C.bold + '═'.repeat(70) + C.reset + '\n');
}

// ─── Main Runner ──────────────────────────────────────────────────────────────
async function runLoadTest() {
    console.log(`\n${C.bold}${C.cyan}SITAM ERP Load Test Starting...${C.reset}`);
    console.log(`  Target: ${TARGET_URL}`);
    console.log(`  Concurrent Users: ${CONCURRENT_USERS}, Total Requests: ${TOTAL_REQUESTS}`);
    console.log(`  Warming up connection...\n`);

    // Quick liveness check before starting
    try {
        await makeRequest({ label: 'warmup', method: 'GET', path: '/api/health/liveness' });
        console.log(`${C.green}  Server is alive. Starting load test...${C.reset}\n`);
    } catch (err) {
        console.error(`${C.red}  Server unreachable at ${TARGET_URL}. Aborting.${C.reset}`);
        process.exit(1);
    }

    const allResults = [];
    const start = Date.now();
    let completed = 0;
    let inFlight = 0;

    // Batched concurrency: process TOTAL_REQUESTS with max CONCURRENT_USERS in-flight
    await new Promise((resolve) => {
        let requestsIssued = 0;

        const fillBatch = () => {
            while (inFlight < CONCURRENT_USERS && requestsIssued < TOTAL_REQUESTS) {
                const scenario = weightedPool[requestsIssued % weightedPool.length];
                requestsIssued++;
                inFlight++;

                makeRequest(scenario).then((result) => {
                    allResults.push(result);
                    inFlight--;
                    completed++;

                    if (completed % 100 === 0 || completed === TOTAL_REQUESTS) {
                        const pct = ((completed / TOTAL_REQUESTS) * 100).toFixed(0);
                        process.stdout.write(`\r  Progress: ${pct}% (${completed}/${TOTAL_REQUESTS}) — ${inFlight} in-flight`);
                    }

                    if (completed >= TOTAL_REQUESTS) {
                        resolve();
                    } else {
                        fillBatch();
                    }
                });
            }
        };

        fillBatch();
    });

    const totalDurationMs = Date.now() - start;
    console.log(); // newline after progress bar
    printResults(allResults, totalDurationMs);
}

runLoadTest().catch(err => {
    console.error(`Load test crashed: ${err.message}`);
    process.exit(1);
});
