/**
 * SITAM Smart ERP — Full API Verification Suite
 * Tests all critical endpoints with runtime evidence.
 * Run after: node server.js (port 3001)
 */
const http = require('http');

const BASE = 'http://localhost:3001';
let PASS = 0, FAIL = 0;
const results = [];

function req(method, path, body, headers = {}) {
    return new Promise((resolve, reject) => {
        const payload = body ? JSON.stringify(body) : null;
        const options = {
            hostname: 'localhost',
            port: 3001,
            path,
            method,
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': payload ? Buffer.byteLength(payload) : 0,
                ...headers
            }
        };
        const r = http.request(options, res => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
                catch (_) { resolve({ status: res.statusCode, body: data }); }
            });
        });
        r.on('error', reject);
        if (payload) r.write(payload);
        r.end();
    });
}

function assert(label, condition, actual) {
    if (condition) {
        console.log(`  ✓ ${label}`);
        PASS++;
        results.push({ label, status: 'PASS', actual });
    } else {
        console.error(`  ✗ FAIL: ${label} — got: ${JSON.stringify(actual)}`);
        FAIL++;
        results.push({ label, status: 'FAIL', actual });
    }
}

async function run() {
    console.log('\n=== SITAM Smart ERP — API Verification Suite ===\n');

    // ── 1. HEALTH ENDPOINTS ─────────────────────────────────────────────────
    console.log('▶ [1] Health Endpoints');

    const liveness = await req('GET', '/api/health/liveness');
    assert('GET /api/health/liveness → 200', liveness.status === 200, liveness);
    assert('liveness.status = alive', liveness.body?.status === 'alive', liveness.body);

    const readiness = await req('GET', '/api/health/readiness');
    assert('GET /api/health/readiness → 200', readiness.status === 200, readiness.body?.status);
    assert('readiness.checks.database = ready', readiness.body?.checks?.database?.status === 'ready', readiness.body?.checks?.database);

    const legacy = await req('GET', '/api/health');
    assert('GET /api/health → 200', legacy.status === 200, legacy.body);

    // ── 2. ROUTE REGISTRATION — Auth ────────────────────────────────────────
    console.log('\n▶ [2] Auth Routes Sanity');

    // Login with missing fields → 400
    const badLogin = await req('POST', '/api/auth/login', {});
    assert('POST /api/auth/login (empty body) → 400', badLogin.status === 400, badLogin.body);

    // Logout without token → 401
    const badLogout = await req('POST', '/api/auth/logout', {});
    assert('POST /api/auth/logout (no token) → 401', badLogout.status === 401, badLogout.body);

    // ── 3. AUTHENTICATED ENDPOINTS — No Token → 401 ─────────────────────────
    console.log('\n▶ [3] Auth Guard on All Protected Endpoints');

    const endpoints401 = [
        ['GET',  '/api/profile'],
        ['GET',  '/api/marks'],
        ['GET',  '/api/attendance'],
        ['GET',  '/api/fees'],
        ['GET',  '/api/timetable'],
        ['GET',  '/api/assignments'],
        ['GET',  '/api/notifications'],
        ['GET',  '/api/exit-passes/my'],
    ];

    for (const [method, path] of endpoints401) {
        const res = await req(method, path);
        assert(`${method} ${path} (no token) → 401`, res.status === 401, res.status);
    }

    // ── 4. ADMIN AUTH ────────────────────────────────────────────────────────
    console.log('\n▶ [4] Admin Auth');

    const adminBadLogin = await req('POST', '/api/admin/auth/login', { email: 'wrong@test.com', password: 'badpass' });
    assert('POST /api/admin/auth/login (wrong creds) → 401', adminBadLogin.status === 401, adminBadLogin.body);

    const adminLogin = await req('POST', '/api/admin/auth/login', {
        email: 'admin@sitamecap.co.in',
        password: 'Admin@SITAM2024'
    });
    assert('POST /api/admin/auth/login (valid) → 200', adminLogin.status === 200, adminLogin.body?.success);
    assert('Admin login returns token', !!(adminLogin.body?.token), adminLogin.body?.token);

    // ── 5. ADMIN PROTECTED ROUTES ────────────────────────────────────────────
    if (adminLogin.body?.token) {
        console.log('\n▶ [5] Admin Protected Routes');
        const adminToken = adminLogin.body.token;
        const headers = { Authorization: `Bearer ${adminToken}` };

        // Admin dashboard is at /stats not root
        const dash = await req('GET', '/api/admin/dashboard/stats', null, headers);
        assert('GET /api/admin/dashboard/stats (admin token) → 200', dash.status === 200, `status=${dash.status}`);

        // /api/student requires :id param — test a specific known route shape
        // (no root GET — parameterised only)
        const noId = await req('GET', '/api/student', null, headers);
        assert('GET /api/student (no :id) → 404 (expected — parameterised routes only)', noId.status === 404, `status=${noId.status}`);
    }

    // ── 6. METRICS ENDPOINT ──────────────────────────────────────────────────
    console.log('\n▶ [6] Metrics');
    const metrics = await req('GET', '/api/metrics?format=json');
    assert('GET /api/metrics → 200', metrics.status === 200, metrics.status);
    assert('metrics has browserPool', !!metrics.body?.browserPool, metrics.body);
    assert('metrics has memory', !!metrics.body?.memory, metrics.body);

    // ── 7. BROWSER POOL STATUS ───────────────────────────────────────────────
    console.log('\n▶ [7] Browser Pool');
    const pool = await req('GET', '/api/browserpool');
    assert('GET /api/browserpool → 200', pool.status === 200, pool.status);

    // ── SUMMARY ──────────────────────────────────────────────────────────────
    console.log('\n═══════════════════════════════════════════');
    console.log(`RESULTS: ${PASS} PASSED  |  ${FAIL} FAILED`);
    console.log('═══════════════════════════════════════════\n');

    if (FAIL > 0) {
        console.error('FAILED TESTS:');
        results.filter(r => r.status === 'FAIL').forEach(r => {
            console.error(`  ✗ ${r.label}`, r.actual);
        });
        process.exit(1);
    } else {
        console.log('ALL API TESTS PASSED ✓');
        process.exit(0);
    }
}

run().catch(err => {
    console.error('FATAL: Test runner crashed:', err.message);
    process.exit(1);
});
