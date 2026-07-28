/**
 * SITAM ERP — Batch 1 Local Security Validation Suite
 * Tests SRE auth bypass fix and WebSocket authentication state machine locally.
 */

const http = require('http');
const express = require('express');
const ws = require('ws');
const assert = require('assert');

// Make sure required env vars are set for startup guards
process.env.ADMIN_JWT_SECRET = 'a_very_long_and_secure_jwt_secret_32_chars_plus';
process.env.ADMIN_PASSWORD_SALT = 'a_very_secure_admin_password_salt_pepper_123';
process.env.WS_AUTH_TIMEOUT_MS = '1000'; // short 1s timeout for testing

const sessionManager = require('../backend/services/sessionManager');
const socketService = require('../backend/services/socketService');
const sreRouter = require('../backend/routes/sre');
const { signToken } = require('../backend/middleware/adminAuth');

async function runSuite() {
    console.log('\n=== SITAM ERP BATCH 1 LOCAL SECURITY TEST SUITE ===\n');

    const app = express();
    app.use(express.json());
    app.use('/api/sre', sreRouter);

    const server = http.createServer(app);
    socketService.init(server);

    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;
    const baseUrl = `http://localhost:${port}`;
    const wsUrl = `ws://localhost:${port}/`;

    console.log(`Server listening on port ${port}`);

    // Create a mock test session in sessionManager
    const testUserId = 'student-test-123';
    const testToken = sessionManager.createSession(testUserId, 'pass123', 'cookies');

    let passed = 0;
    let failed = 0;

    async function test(name, fn) {
        try {
            await fn();
            console.log(`  ✓ [PASS] ${name}`);
            passed++;
        } catch (err) {
            console.error(`  ✗ [FAIL] ${name}: ${err.message}`);
            failed++;
        }
    }

    // ── 1. SRE Route Tests ───────────────────────────────────────────────────
    await test('P0-1 SRE: x-sre-role header without JWT returns 401', async () => {
        const res = await fetch(`${baseUrl}/api/sre/status`, {
            headers: { 'x-sre-role': 'admin' }
        });
        assert.strictEqual(res.status, 401, `Expected 401, got ${res.status}`);
    });

    await test('P0-1 SRE: Valid Admin JWT returns 200', async () => {
        const adminJwt = signToken({ id: 'admin-1', email: 'admin@sitam.edu', role: 'ADMIN' });
        const res = await fetch(`${baseUrl}/api/sre/status`, {
            headers: { 'Authorization': `Bearer ${adminJwt}` }
        });
        assert.strictEqual(res.status, 200, `Expected 200, got ${res.status}`);
    });

    // ── 2. WebSocket Protocol Tests ──────────────────────────────────────────
    await test('WS-1: No auth message within timeout -> closed with 4002', async () => {
        const client = new ws.WebSocket(wsUrl);
        const code = await new Promise((resolve) => {
            client.on('close', (c) => resolve(c));
        });
        assert.strictEqual(code, 4002, `Expected close code 4002, got ${code}`);
    });

    await test('WS-2: Malformed auth message -> closed with 4003', async () => {
        const client = new ws.WebSocket(wsUrl);
        await new Promise((resolve) => client.on('open', resolve));
        client.send('NOT_JSON');
        const code = await new Promise((resolve) => client.on('close', (c) => resolve(c)));
        assert.strictEqual(code, 4003, `Expected close code 4003, got ${code}`);
    });

    await test('WS-3: Invalid token -> closed with 4001', async () => {
        const client = new ws.WebSocket(wsUrl);
        await new Promise((resolve) => client.on('open', resolve));
        client.send(JSON.stringify({ type: 'auth', token: 'invalid-token-uuid-1234' }));
        const code = await new Promise((resolve) => client.on('close', (c) => resolve(c)));
        assert.strictEqual(code, 4001, `Expected close code 4001, got ${code}`);
    });

    await test('WS-4: Valid token -> receives auth_success acknowledgement', async () => {
        const client = new ws.WebSocket(wsUrl);
        await new Promise((resolve) => client.on('open', resolve));
        client.send(JSON.stringify({ type: 'auth', token: testToken }));

        const msg = await new Promise((resolve, reject) => {
            client.on('message', (data) => resolve(JSON.parse(data.toString())));
            client.on('close', (code) => reject(new Error(`Closed early with code ${code}`)));
        });

        assert.strictEqual(msg.event, 'auth_success', `Expected event 'auth_success', got ${msg.event}`);
        client.close();
    });

    await test('WS-5: Valid authenticated socket receives targeted user events', async () => {
        const client = new ws.WebSocket(wsUrl);
        await new Promise((resolve) => client.on('open', resolve));
        client.send(JSON.stringify({ type: 'auth', token: testToken }));

        await new Promise((resolve) => {
            client.on('message', (data) => {
                const msg = JSON.parse(data.toString());
                if (msg.event === 'auth_success') resolve();
            });
        });

        // Broadcast targeted message to testUserId
        const pushPromise = new Promise((resolve) => {
            client.on('message', (data) => {
                const msg = JSON.parse(data.toString());
                if (msg.event === 'test_event') resolve(msg.data);
            });
        });

        socketService.sendToUser(testUserId, 'test_event', { payload: 'hello_student' });
        const received = await pushPromise;
        assert.strictEqual(received.payload, 'hello_student');

        client.close();
    });

    await test('WS-6: Forged ?userId= in query URL cannot change socket identity', async () => {
        const forgedUrl = `${wsUrl}?userId=victim-student-999`;
        const client = new ws.WebSocket(forgedUrl);
        await new Promise((resolve) => client.on('open', resolve));
        client.send(JSON.stringify({ type: 'auth', token: testToken }));

        await new Promise((resolve) => {
            client.on('message', (data) => {
                if (JSON.parse(data.toString()).event === 'auth_success') resolve();
            });
        });

        // Verify socket is registered under testUserId (derived from session), NOT victim-student-999
        const isTargetedToVictim = socketService.sendToUser('victim-student-999', 'test_victim_event', {});
        assert.strictEqual(isTargetedToVictim, false, 'Socket must NOT be registered under forged userId');

        const isTargetedToTestUser = socketService.sendToUser(testUserId, 'test_user_event', {});
        assert.strictEqual(isTargetedToTestUser, true, 'Socket MUST be registered under session userId');

        client.close();
    });

    socketService.shutdown();
    server.close();

    console.log(`\n==================================================`);
    console.log(`Results: Passed: ${passed} | Failed: ${failed}`);
    console.log(`==================================================\n`);

    if (failed > 0) process.exit(1);
}

runSuite().catch((err) => {
    console.error('Test suite runner crashed:', err);
    process.exit(1);
});
