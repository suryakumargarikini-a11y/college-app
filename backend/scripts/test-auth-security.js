/**
 * AUTH CONTROLLER — Security Regression Test
 * Run: node scripts/test-auth-security.js
 */
'use strict';

process.env.NODE_ENV = 'test';
process.env.DEMO_MODE = 'true';
process.env.ERP_PROVIDER = 'mock';

const assert = require('assert');

// ── Minimal mocks ─────────────────────────────────────────────────────────────

let dbStudentStore = {};
const mockPrisma = {
    student: {
        findUnique: async ({ where }) => dbStudentStore[where.userId] || null,
        update: async ({ where, data }) => {
            if (dbStudentStore[where.userId]) Object.assign(dbStudentStore[where.userId], data);
            return dbStudentStore[where.userId];
        }
    }
};
require.cache[require.resolve('../services/dbService')] = { exports: mockPrisma };

const issuedTokens = [];
const mockSessionManager = {
    createSession: (userId, password, cookies, scraped, role, isParent) => {
        const token = `test-token-${userId}-${Date.now()}`;
        issuedTokens.push({ token, userId, role });
        return token;
    }
};
require.cache[require.resolve('../services/sessionManager')] = { exports: mockSessionManager };

const memCache = {};
const mockCacheService = {
    get:  async (ns, key) => memCache[`${ns}:${key}`] || null,
    set:  (ns, key, val)  => { memCache[`${ns}:${key}`] = val; },
    del:  (ns, key)       => { delete memCache[`${ns}:${key}`]; }
};
require.cache[require.resolve('../services/cacheService')] = { exports: mockCacheService };

require.cache[require.resolve('../services/syncService')] = {
    exports: { triggerProviderSync: async () => {} }
};

const mockLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
require.cache[require.resolve('../services/logger')] = { exports: mockLogger };

require.cache[require.resolve('../services/ObservabilityScheduler')] = {
    exports: { getBusinessCollector: () => null }
};

const writtenStudents = [];
const mockStudentRepository = {
    upsertStudent: async (userId, data) => {
        const record = { id: `db-${userId}`, userId, name: data.name || userId, password: data.password || '' };
        dbStudentStore[userId] = record;
        writtenStudents.push({ userId, data });
        return record;
    }
};
require.cache[require.resolve('../repositories')] = {
    exports: { studentRepository: mockStudentRepository, auditLogRepository: { log: async () => {} } }
};

const mockCryptoHelper = {
    encrypt: (p) => `enc:${p}`,
    decrypt: (enc) => {
        if (!enc || !enc.startsWith('enc:')) throw new Error('Cannot decrypt non-AES value');
        return enc.slice(4);
    }
};
require.cache[require.resolve('../services/cryptoHelper')] = { exports: mockCryptoHelper };

require.cache[require.resolve('../providers/session/ProviderSessionManager')] = {
    exports: { invalidate: async () => {} }
};

// Load controller AFTER mocks
const { login } = require('../controllers/authController');

// ── Helpers ───────────────────────────────────────────────────────────────────
function makeReq(userId, password) {
    return { body: { userId, password }, ip: '127.0.0.1', requestId: 'test-req', headers: {} };
}
function makeRes() {
    const res = { _status: 200, _body: null };
    res.status = (code) => { res._status = code; return res; };
    res.json   = (body)  => { res._body  = body; return res; };
    return res;
}

function reset() {
    for (const k of Object.keys(dbStudentStore)) delete dbStudentStore[k];
    for (const k of Object.keys(memCache))        delete memCache[k];
    issuedTokens.length    = 0;
    writtenStudents.length = 0;
}

let passed = 0, failed = 0;
async function test(name, fn) {
    try {
        await fn();
        console.log(`  \u2713 ${name}`);
        passed++;
    } catch (err) {
        console.error(`  \u2717 ${name}`);
        console.error(`    \u2192 ${err.message}`);
        failed++;
    }
}

// ═════════════════════════════════════════════════════════════════════════════
async function main() {
    console.log('\n\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550');
    console.log(' SITAM Auth Security Regression Tests');
    console.log('\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\n');

    // ── PATH C (unknown student, first-time login) ────────────────────────────
    console.log('[PATH C] Unknown student — not in DB');

    await test('A. Unknown student + wrong password → 401, NO token, NO DB record', async () => {
        reset();
        const res = makeRes();
        await login(makeReq('UNKNOWN001', 'wrong'), res);
        assert.strictEqual(res._status,   401,   `Expected 401, got ${res._status}`);
        assert.strictEqual(res._body.success, false);
        assert.strictEqual(issuedTokens.length,  0,   'Token must NOT be issued for wrong password');
        assert.strictEqual(writtenStudents.length, 0, 'DB record must NOT be written before auth succeeds');
    });

    await test('B. Unknown student + correct credentials → 200, token issued, DB record created', async () => {
        reset();
        const res = makeRes();
        await login(makeReq('NEW001', 'correctPass'), res);
        assert.strictEqual(res._body.success, true, JSON.stringify(res._body));
        assert.ok(res._body.token,                   'Token must be returned');
        assert.strictEqual(issuedTokens.length,   1, 'Exactly 1 token must be issued');
        assert.strictEqual(writtenStudents.length, 1, 'Exactly 1 DB record must be created');
        assert.strictEqual(writtenStudents[0].userId, 'NEW001');
    });

    // ── PATH B (student exists, wrong password) ───────────────────────────────
    console.log('\n[PATH B] Student in DB/cache — password does NOT match stored credential');

    await test('C. Existing student + wrong password → 401, NO token', async () => {
        reset();
        dbStudentStore['EXIST001'] = {
            id: 'db-e1', userId: 'EXIST001', name: 'Existing Student', password: 'enc:storedPass'
        };
        memCache['user_credentials:EXIST001'] = dbStudentStore['EXIST001'];

        const res = makeRes();
        await login(makeReq('EXIST001', 'wrong'), res);
        assert.strictEqual(res._status, 401,  `Expected 401, got ${res._status} — ${JSON.stringify(res._body)}`);
        assert.strictEqual(res._body.success, false);
        assert.strictEqual(issuedTokens.length, 0, 'Token must NOT be issued for wrong password');
    });

    await test('D. Existing student + different-but-correct credentials → provider verifies → 200, token issued', async () => {
        reset();
        dbStudentStore['EXIST002'] = {
            id: 'db-e2', userId: 'EXIST002', name: 'Existing Student 2', password: 'enc:oldPass'
        };
        memCache['user_credentials:EXIST002'] = dbStudentStore['EXIST002'];

        // 'newPass' ≠ 'oldPass' so local check fails → provider called → MockERPProvider accepts it
        const res = makeRes();
        await login(makeReq('EXIST002', 'newPass'), res);
        assert.strictEqual(res._body.success, true, JSON.stringify(res._body));
        assert.ok(res._body.token, 'Token must be returned after provider re-verification');
        assert.strictEqual(issuedTokens.length, 1);
    });

    // ── PATH A (student in DB, password matches locally) ─────────────────────
    console.log('\n[PATH A] Student in DB/cache — password matches stored credential exactly');

    await test('E. Existing student + correct cached password → instant token (fast path)', async () => {
        reset();
        dbStudentStore['CACHED01'] = {
            id: 'db-c1', userId: 'CACHED01', name: 'Cached Student', password: 'enc:myPass'
        };
        memCache['user_credentials:CACHED01'] = dbStudentStore['CACHED01'];

        const res = makeRes();
        await login(makeReq('CACHED01', 'myPass'), res); // 'myPass' → decrypt → match
        assert.strictEqual(res._body.success, true, JSON.stringify(res._body));
        assert.ok(res._body.token);
        assert.strictEqual(issuedTokens.length, 1);
    });

    // ── ISOLATION ─────────────────────────────────────────────────────────────
    console.log('\n[ISOLATION] Student A vs Student B session isolation');

    await test('F. Student A then Student B → separate tokens, separate userIds', async () => {
        reset();
        const resA = makeRes();
        await login(makeReq('STU_A', 'passA'), resA);
        assert.ok(resA._body.success, JSON.stringify(resA._body));

        const resB = makeRes();
        await login(makeReq('STU_B', 'passB'), resB);
        assert.ok(resB._body.success, JSON.stringify(resB._body));

        assert.strictEqual(issuedTokens.length, 2);
        assert.notStrictEqual(issuedTokens[0].token, issuedTokens[1].token, 'Tokens must differ!');
        assert.strictEqual(issuedTokens[0].userId, 'STU_A');
        assert.strictEqual(issuedTokens[1].userId, 'STU_B');
    });

    await test('G. Failed login must not pollute cache/DB for subsequent successful login', async () => {
        reset();
        // Failed attempt
        const resFail = makeRes();
        await login(makeReq('STU_X', 'wrong'), resFail);
        assert.strictEqual(resFail._status, 401);
        assert.strictEqual(writtenStudents.length, 0, 'No DB write on failed login');
        const cacheKeys = Object.keys(memCache).filter(k => k.includes('STU_X'));
        assert.strictEqual(cacheKeys.length, 0, 'Cache must not be polluted on failed login');

        // Successful attempt after the failed one
        const resOk = makeRes();
        await login(makeReq('STU_X', 'correctPass'), resOk);
        assert.ok(resOk._body.success, 'Correct credentials must succeed after failed attempt');
        assert.strictEqual(issuedTokens.length, 1, 'Exactly 1 token from 1 successful login');
    });

    // ── VALIDATION ────────────────────────────────────────────────────────────
    console.log('\n[VALIDATION] Missing / empty credentials');

    await test('H. Empty userId → 400, no token', async () => {
        reset();
        const res = makeRes();
        await login(makeReq('', 'somePass'), res);
        assert.strictEqual(res._status, 400);
        assert.strictEqual(issuedTokens.length, 0);
    });

    await test('I. Empty password → 400, no token', async () => {
        reset();
        const res = makeRes();
        await login(makeReq('SOME_USER', ''), res);
        assert.strictEqual(res._status, 400);
        assert.strictEqual(issuedTokens.length, 0);
    });

    // ── SUMMARY ───────────────────────────────────────────────────────────────
    console.log('\n\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550');
    console.log(` Results: ${passed} passed, ${failed} failed`);
    console.log('\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\n');
    if (failed > 0) process.exit(1);
}

main().catch(err => {
    console.error('FATAL:', err);
    process.exit(1);
});
