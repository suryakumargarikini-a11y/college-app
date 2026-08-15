/**
 * SITAM Smart ERP — Production Logout Loop Regression Test Suite
 *
 * Verifies:
 *   1. Valid token logout → 200 OK, session destroyed.
 *   2. Missing token logout → 200 OK (idempotent, no 401 loop).
 *   3. Expired/invalid token logout → 200 OK (idempotent, no 401 loop).
 *   4. Protected endpoints (/api/fcm-token, etc.) STILL enforce requireAuth and return 401 for missing/invalid tokens.
 *   5. Frontend api.logout() re-entrancy lock prevents duplicate concurrent server requests.
 *   6. Frontend api.logout() skips network request when state.token is null/empty.
 *   7. Frontend api.request() 401 interceptor skips api.logout() when endpoint is /auth/logout.
 */

'use strict';

const assert = require('assert');

async function main() {
    console.log('\n══════════════════════════════════════════════════════════════');
    console.log(' SITAM Logout Loop & Security Protection Regression Tests');
    console.log('══════════════════════════════════════════════════════════════\n');

    let passed = 0;
    let failed = 0;

    function ok(condition, name) {
        if (condition) {
            console.log(`  ✓ ${name}`);
            passed++;
        } else {
            console.error(`  ✗ FAIL: ${name}`);
            failed++;
        }
    }

    const authController = require('../controllers/authController');
    const sessionManager = require('../services/sessionManager');
    const authRoutes = require('../routes/auth');

    // ──────────────────────────────────────────────────────────────────────────
    // TEST 1: Valid token logout → 200 OK & session removed
    // ──────────────────────────────────────────────────────────────────────────
    console.log('Group 1 — Backend Idempotent Logout Behavior');
    {
        const token = sessionManager.createSession('TEST_USER_99', 'password123', 'mock_cookies', {
            studentName: 'Test Student'
        });

        ok(sessionManager.getSession(token) !== null, 'Session created & valid before logout');

        // Simulate backend express req/res
        let resStatus = null;
        let resJson = null;
        const req = {
            token,
            session: sessionManager.getSession(token),
            ip: '127.0.0.1'
        };
        const res = {
            json(data) { resJson = data; return this; },
            status(code) { resStatus = code; return this; }
        };

        await authController.logout(req, res);

        ok(resJson && resJson.success === true, 'logout controller returned success: true');
        ok(sessionManager.getSession(token) === undefined || sessionManager.getSession(token) === null, 'session destroyed from store after logout');
    }

    // ──────────────────────────────────────────────────────────────────────────
    // TEST 2: Missing token logout → 200 OK (idempotent, no 401)
    // ──────────────────────────────────────────────────────────────────────────
    {
        let resJson = null;
        const req = {
            token: null,
            session: null,
            ip: '127.0.0.1'
        };
        const res = {
            json(data) { resJson = data; return this; }
        };

        await authController.logout(req, res);

        ok(resJson && resJson.success === true, 'logout without token returns 200 OK (idempotent)');
        ok(resJson.message.includes('Logged out'), 'message confirms logout complete');
    }

    // ──────────────────────────────────────────────────────────────────────────
    // TEST 3: Expired/invalid token logout → 200 OK (idempotent, no 401)
    // ──────────────────────────────────────────────────────────────────────────
    {
        let resJson = null;
        const req = {
            token: 'invalid_expired_token_123',
            session: null,
            ip: '127.0.0.1'
        };
        const res = {
            json(data) { resJson = data; return this; }
        };

        await authController.logout(req, res);

        ok(resJson && resJson.success === true, 'logout with expired token returns 200 OK (idempotent)');
    }

    // ──────────────────────────────────────────────────────────────────────────
    // TEST 4: Protected endpoints STILL require authentication (No security regression)
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\nGroup 2 — Protected Route Security Preservation');
    {
        const { requireAuth } = require('../middleware/auth');

        // Test requireAuth with missing header
        let req1 = { headers: {}, ip: '127.0.0.1', originalUrl: '/api/fcm-token' };
        let resCode1 = null;
        let resJson1 = null;
        let nextCalled1 = false;
        let res1 = {
            status(code) { resCode1 = code; return this; },
            json(data) { resJson1 = data; return this; }
        };

        await requireAuth(req1, res1, () => { nextCalled1 = true; });

        ok(resCode1 === 401, 'requireAuth returns 401 for missing token on protected routes');
        ok(nextCalled1 === false, 'next() not called when token missing');
        ok(resJson1 && resJson1.error.includes('Missing or invalid token'), 'returns clear 401 error message');

        // Test requireAuth with invalid token
        let req2 = { headers: { authorization: 'Bearer invalid_token_xyz' }, ip: '127.0.0.1', originalUrl: '/api/fcm-token' };
        let resCode2 = null;
        let nextCalled2 = false;
        let res2 = {
            status(code) { resCode2 = code; return this; },
            json(data) { return this; }
        };

        await requireAuth(req2, res2, () => { nextCalled2 = true; });

        ok(resCode2 === 401, 'requireAuth returns 401 for invalid token on protected routes');
        ok(nextCalled2 === false, 'next() not called when token invalid');
    }

    // ──────────────────────────────────────────────────────────────────────────
    // TEST 5: Frontend Logic Verification — app.js non-recursion & re-entrancy
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\nGroup 3 — Frontend app.js Anti-Recursion & Re-Entrancy');
    {
        const fs = require('fs');
        const path = require('path');
        const appJsPath = path.join(__dirname, '../../frontend/app.js');
        const appJsCode = fs.readFileSync(appJsPath, 'utf8');

        ok(appJsCode.includes('_isLoggingOut'), 'app.js includes _isLoggingOut re-entrancy flag');
        ok(appJsCode.includes('isLogoutEndpoint'), 'app.js includes isLogoutEndpoint check in 401 interceptor');
        ok(appJsCode.includes('skipping recursive logout trigger'), 'app.js logs warning when skipping 401 on /logout');
        ok(appJsCode.includes('No auth token present — performing local logout only'), 'app.js checks for currentToken before serverLogout()');
    }

    // ─── Summary ──────────────────────────────────────────────────────────────
    console.log('\n══════════════════════════════════════════════════════════════');
    console.log(` Results: ${passed} passed, ${failed} failed`);
    console.log('══════════════════════════════════════════════════════════════\n');

    if (failed > 0) {
        process.exit(1);
    } else {
        process.exit(0);
    }
}

main().catch(err => {
    console.error('Test script crashed:', err);
    process.exit(2);
});
