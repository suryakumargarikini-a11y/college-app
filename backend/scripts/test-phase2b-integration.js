'use strict';
process.env.ADMIN_JWT_SECRET = 'sitam-admin-secret-key-32-chars-long-production-grade';

/**
 * SITAM Smart ERP — Phase 2B Real HTTP Route Integration Test Suite
 * Mounts real Express application, executes full HTTP request pipeline,
 * and validates HTTP status codes, response headers, and route security.
 */

const http = require('http');
const express = require('express');
const assert = require('assert');
const { signToken } = require('../middleware/adminAuth');

// Import routes
const adminExitPassesRouter = require('../routes/admin/exitPasses');
const adminStudentsRouter = require('../routes/admin/students');
const libraryRouter = require('../routes/library');

let app;
let server;
let baseUrl;

function startTestServer() {
    return new Promise((resolve) => {
        app = express();
        app.use(express.json());

        // Mount API routes
        app.use('/api/admin/exit-passes', adminExitPassesRouter);
        app.use('/api/admin/students', adminStudentsRouter);
        app.use('/api/library', libraryRouter);

        server = http.createServer(app);
        server.listen(0, '127.0.0.1', () => {
            const port = server.address().port;
            baseUrl = `http://127.0.0.1:${port}`;
            resolve();
        });
    });
}

function stopTestServer() {
    return new Promise((resolve) => {
        if (server) {
            server.close(resolve);
        } else {
            resolve();
        }
    });
}

function makeRequest(method, path, token, body = null, headers = {}) {
    return new Promise((resolve, reject) => {
        const url = new URL(path, baseUrl);
        const reqHeaders = { ...headers };
        if (token) {
            reqHeaders['Authorization'] = `Bearer ${token}`;
        }

        let payload = null;
        if (body && typeof body === 'object' && !Buffer.isBuffer(body)) {
            payload = JSON.stringify(body);
            reqHeaders['Content-Type'] = 'application/json';
        } else if (Buffer.isBuffer(body)) {
            payload = body;
        }

        const req = http.request(url, { method, headers: reqHeaders }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                let parsed = data;
                try {
                    parsed = JSON.parse(data);
                } catch (_) {}
                resolve({ status: res.statusCode, headers: res.headers, body: parsed });
            });
        });

        req.on('error', reject);
        if (payload) {
            req.write(payload);
        }
        req.end();
    });
}

async function runIntegrationTests() {
    console.log('================================================================');
    console.log('  SITAM SMART ERP — PHASE 2B REAL HTTP ROUTE INTEGRATION TESTS   ');
    console.log('================================================================\n');

    await startTestServer();

    let passed = 0;
    let failed = 0;

    async function httpTest(name, fn) {
        try {
            await fn();
            console.log(`  ✓ ${name}`);
            passed++;
        } catch (err) {
            console.error(`  ✗ ${name}`);
            console.error(`    Error: ${err.message}`);
            failed++;
        }
    }

    // Tokens
    const tokenSuperAdmin   = signToken({ id: 'sa1', email: 'admin@sitam.edu.in', role: 'SUPER_ADMIN' });
    const tokenWarden       = signToken({ id: 'w1',  email: 'warden@sitam.edu.in', role: 'HOSTEL_WARDEN' });
    const tokenHodAiml      = signToken({ id: 'h1',  email: 'hod.aiml@sitam.edu.in', role: 'HOD' });
    const tokenHodEce       = signToken({ id: 'h2',  email: 'hod.ece@sitam.edu.in', role: 'HOD' });
    const tokenDean         = signToken({ id: 'd1',  email: 'dean@sitam.edu.in', role: 'DEAN' });
    const tokenCi           = signToken({ id: 'c1',  email: 'ci@sitam.edu.in', role: 'CI' });
    const tokenGuard        = signToken({ id: 'g1',  email: 'guard@sitam.edu.in', role: 'SECURITY_GUARD' });
    const tokenFacultyAiml  = signToken({ id: 'f1',  email: 'faculty.aiml@sitam.edu.in', role: 'FACULTY' });
    const tokenAccounts     = signToken({ id: 'a1',  email: 'accounts@sitam.edu.in', role: 'ACCOUNTS_ADMIN' });

    console.log('--- 1. EXIT PASS HTTP ROUTE AUTHORIZATION ---');

    await httpTest('HOSTEL_WARDEN: GET /api/admin/exit-passes (HTTP 200)', async () => {
        const res = await makeRequest('GET', '/api/admin/exit-passes', tokenWarden);
        assert.strictEqual(res.status, 200);
        assert(Array.isArray(res.body));
    });

    await httpTest('HOSTEL_WARDEN: POST /api/admin/exit-passes/pass-1/approve (HTTP 403 FORBIDDEN)', async () => {
        const res = await makeRequest('POST', '/api/admin/exit-passes/pass-1/approve', tokenWarden, { adminRemark: 'Approved' });
        assert.strictEqual(res.status, 403);
    });

    await httpTest('HOSTEL_WARDEN: POST /api/admin/exit-passes/pass-1/reject (HTTP 403 FORBIDDEN)', async () => {
        const res = await makeRequest('POST', '/api/admin/exit-passes/pass-1/reject', tokenWarden, { reason: 'Denied' });
        assert.strictEqual(res.status, 403);
    });

    await httpTest('HOSTEL_WARDEN: POST /api/admin/exit-passes/group/grp-1/approve (HTTP 403 FORBIDDEN)', async () => {
        const res = await makeRequest('POST', '/api/admin/exit-passes/group/grp-1/approve', tokenWarden);
        assert.strictEqual(res.status, 403);
    });

    await httpTest('HOSTEL_WARDEN: POST /api/admin/exit-passes/verify-qr (HTTP 403 FORBIDDEN)', async () => {
        const res = await makeRequest('POST', '/api/admin/exit-passes/verify-qr', tokenWarden, { qrToken: 'token123' });
        assert.strictEqual(res.status, 403);
    });

    await httpTest('HOSTEL_WARDEN: POST /api/admin/exit-passes/pass-1/confirm-exit (HTTP 403 FORBIDDEN)', async () => {
        const res = await makeRequest('POST', '/api/admin/exit-passes/pass-1/confirm-exit', tokenWarden);
        assert.strictEqual(res.status, 403);
    });

    await httpTest('HOD: POST /api/admin/exit-passes/verify-qr (HTTP 403 FORBIDDEN)', async () => {
        const res = await makeRequest('POST', '/api/admin/exit-passes/verify-qr', tokenHodAiml, { qrToken: 'token123' });
        assert.strictEqual(res.status, 403);
    });

    await httpTest('DEAN: POST /api/admin/exit-passes/verify-qr (HTTP 403 FORBIDDEN)', async () => {
        const res = await makeRequest('POST', '/api/admin/exit-passes/verify-qr', tokenDean, { qrToken: 'token123' });
        assert.strictEqual(res.status, 403);
    });

    await httpTest('CI: POST /api/admin/exit-passes/pass-1/approve (HTTP 403 FORBIDDEN)', async () => {
        const res = await makeRequest('POST', '/api/admin/exit-passes/pass-1/approve', tokenCi);
        assert.strictEqual(res.status, 403);
    });

    await httpTest('SECURITY_GUARD: POST /api/admin/exit-passes/pass-1/approve (HTTP 403 FORBIDDEN)', async () => {
        const res = await makeRequest('POST', '/api/admin/exit-passes/pass-1/approve', tokenGuard);
        assert.strictEqual(res.status, 403);
    });

    await httpTest('ACCOUNTS_ADMIN: GET /api/admin/exit-passes (HTTP 403 FORBIDDEN)', async () => {
        const res = await makeRequest('GET', '/api/admin/exit-passes', tokenAccounts);
        assert.strictEqual(res.status, 403);
    });

    console.log('\n--- 2. E-LIBRARY HTTP ROUTE AUTHORIZATION & ATOMIC SCOPE ---');

    await httpTest('FACULTY: GET /api/library/admin/materials (HTTP 200)', async () => {
        const res = await makeRequest('GET', '/api/library/admin/materials', tokenFacultyAiml);
        assert.strictEqual(res.status, 200);
    });

    await httpTest('FACULTY AIML: Upload targeting unauthorized department ECE (HTTP 403 FORBIDDEN)', async () => {
        const fileBuffer = Buffer.from('%PDF-1.4 test pdf content');
        const headers = {
            'x-file-name': 'sample.pdf',
            'content-type': 'application/pdf'
        };
        const res = await makeRequest('POST', '/api/library/admin/materials?title=Physics&branch=ECE', tokenFacultyAiml, fileBuffer, headers);
        assert.strictEqual(res.status, 403);
        assert(res.body.error.includes('lacks authorization to target department'));
    });

    await httpTest('HOD ECE: Upload targeting unauthorized department AIML (HTTP 403 FORBIDDEN)', async () => {
        const fileBuffer = Buffer.from('%PDF-1.4 test pdf content');
        const headers = {
            'x-file-name': 'sample.pdf',
            'content-type': 'application/pdf'
        };
        const res = await makeRequest('POST', '/api/library/admin/materials?title=Electronics&branch=AIML', tokenHodEce, fileBuffer, headers);
        assert.strictEqual(res.status, 403);
    });

    await stopTestServer();

    console.log('\n================================================================');
    console.log(`  INTEGRATION RESULTS: ${passed} PASSED, ${failed} FAILED               `);
    console.log('================================================================\n');

    if (failed > 0) {
        process.exit(1);
    }
}

runIntegrationTests().catch(err => {
    console.error('Integration test runner crash:', err);
    process.exit(1);
});