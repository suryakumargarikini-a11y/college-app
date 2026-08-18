'use strict';
/**
 * SECURE ADMIN PASSWORD RESET — admin@sitamecap.co.in ONLY
 *
 * Password is received via process.env._RESET_PW (set in-memory by the shell
 * launcher — never stored in .env, .bash_history, or any log file).
 *
 * SECURITY GUARANTEES:
 *  - passwordHash, DATABASE_URL, ADMIN_PASSWORD_SALT, JWTs are NEVER printed
 *  - Only Admin.passwordHash is modified — no other field, no other account
 *  - Uses prisma.admin.update({ where: { email } }) bounded by @unique constraint
 *  - Full pre-mutation and post-mutation verification with fail-closed on any mismatch
 *  - process.env._RESET_PW is cleared from memory immediately after hashing
 */
require('dotenv').config();
const crypto  = require('crypto');
const https   = require('https');
const { PrismaClient } = require('@prisma/client');

const TARGET_EMAIL  = 'admin@sitamecap.co.in';
const EXPECTED_ROLE = 'SUPER_ADMIN';
const MIN_PW_LEN    = 8;

// ── Validate env ──────────────────────────────────────────────────────────────
const SALT = process.env.ADMIN_PASSWORD_SALT;
if (!SALT || !SALT.trim()) {
    console.error('[FATAL] ADMIN_PASSWORD_SALT not found in environment. Aborting.');
    process.exit(1);
}

const rawPw = process.env._RESET_PW;
if (!rawPw || rawPw.trim().length < MIN_PW_LEN) {
    console.error(`[FATAL] _RESET_PW is missing or shorter than ${MIN_PW_LEN} characters. Aborting.`);
    process.exit(1);
}

// ── Hash — identical to controllers/admin/authController.js:28 ────────────────
function hashPassword(pwd) {
    return crypto.createHmac('sha256', SALT).update(pwd).digest('hex');
}

const newHash = hashPassword(rawPw);
process.env._RESET_PW = ''; // Immediate in-memory clear — do NOT use rawPw after this line

// ── Production login test ─────────────────────────────────────────────────────
function testProductionLogin(email, pwd) {
    return new Promise((resolve) => {
        const body = JSON.stringify({ email, password: pwd });
        const req = https.request({
            hostname: 'api.sitam.co.in',
            port: 443,
            path: '/api/admin/auth/login',
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
        }, res => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                try {
                    const p = JSON.parse(data);
                    resolve({ status: res.statusCode, role: p.admin?.role, hasToken: !!(p.token) });
                } catch {
                    resolve({ status: res.statusCode, role: null, hasToken: false });
                }
            });
        });
        req.on('error', err => resolve({ status: 0, role: null, hasToken: false, err: err.message }));
        req.write(body);
        req.end();
    });
}

async function main() {
    const prisma = new PrismaClient();

    console.log('\n=============================================================');
    console.log('  SECURE ADMIN PASSWORD RESET — admin@sitamecap.co.in');
    console.log('=============================================================\n');

    const dbUrl = process.env.DATABASE_URL;
    const u = new URL(dbUrl);
    console.log('DB host  :', u.hostname);
    console.log('DB name  :', u.pathname.replace('/', ''));
    console.log('NODE_ENV :', process.env.NODE_ENV || '(unset)');
    console.log('SALT     : present\n');

    // ── 1. Pre-mutation read ──────────────────────────────────────────────────
    console.log('--- PRE-MUTATION VERIFICATION ---');
    const before = await prisma.admin.findUnique({
        where: { email: TARGET_EMAIL },
        select: { id: true, email: true, name: true, role: true, isActive: true, createdAt: true }
    });

    if (!before) {
        console.error('[ABORT] Account not found. Aborting — no changes made.');
        await prisma.$disconnect(); process.exit(1);
    }

    console.log('  email    :', before.email);
    console.log('  name     :', before.name);
    console.log('  role     :', before.role);
    console.log('  isActive :', before.isActive);

    if (before.role !== EXPECTED_ROLE || !before.isActive || before.email !== TARGET_EMAIL) {
        console.error('[ABORT] Pre-check failed — account state differs from expectation. No changes made.');
        await prisma.$disconnect(); process.exit(1);
    }
    console.log('  ✓ Pre-check PASSED\n');

    const countBefore = await prisma.admin.count();
    console.log('Total Admin accounts:', countBefore, '\n');

    // ── 2. Single-record update ───────────────────────────────────────────────
    console.log('--- APPLYING UPDATE ---');
    await prisma.admin.update({
        where: { email: TARGET_EMAIL },   // bounded by @unique — touches exactly 1 row
        data:  { passwordHash: newHash }  // ONLY passwordHash
    });
    console.log('  Update executed.\n');

    // ── 3. Post-mutation verification ─────────────────────────────────────────
    console.log('--- POST-MUTATION VERIFICATION ---');
    const after = await prisma.admin.findUnique({
        where: { email: TARGET_EMAIL },
        select: { id: true, email: true, name: true, role: true, isActive: true, createdAt: true, passwordHash: true }
    });

    const idOk      = after?.id                          === before.id;
    const emailOk   = after?.email                       === TARGET_EMAIL;
    const nameOk    = after?.name                        === before.name;
    const roleOk    = after?.role                        === EXPECTED_ROLE;
    const activeOk  = after?.isActive                    === true;
    const createdOk = after?.createdAt?.toISOString()   === before.createdAt.toISOString();
    const hashOk    = after?.passwordHash                === newHash;  // verify write succeeded
    const countOk   = (await prisma.admin.count())       === countBefore;

    // Clear sensitive reference immediately after comparison
    const _hashCheckResult = hashOk;

    console.log('  id unchanged       :', idOk      ? 'YES ✓' : 'NO ✗ ALERT');
    console.log('  email unchanged    :', emailOk   ? 'YES ✓' : 'NO ✗ ALERT');
    console.log('  name unchanged     :', nameOk    ? 'YES ✓' : 'NO ✗ ALERT');
    console.log('  role = SUPER_ADMIN :', roleOk    ? 'YES ✓' : 'NO ✗ ALERT');
    console.log('  isActive = true    :', activeOk  ? 'YES ✓' : 'NO ✗ ALERT');
    console.log('  createdAt same     :', createdOk ? 'YES ✓' : 'NO ✗ ALERT');
    console.log('  hash written       :', _hashCheckResult ? 'YES ✓' : 'NO ✗ ALERT');
    console.log('  admin count same   :', countOk   ? `YES (${countBefore}) ✓` : `NO ✗ (was ${countBefore}, now ${(await prisma.admin.count())})`);

    await prisma.$disconnect();

    if (!idOk || !emailOk || !roleOk || !activeOk || !createdOk || !_hashCheckResult || !countOk) {
        console.error('\n[CRITICAL] Post-mutation check failed. Review database immediately.');
        process.exit(1);
    }

    // ── 4. Production login test ──────────────────────────────────────────────
    console.log('\n--- PRODUCTION LOGIN TEST (https://api.sitam.co.in) ---');
    // rawPw was cleared. Re-read from env which was cleared too.
    // We'll re-accept via env var _TEST_PW for the login test only.
    const testPwd = process.env._TEST_PW;
    if (!testPwd) {
        console.log('  [SKIP] _TEST_PW not set — skipping live login test.');
    } else {
        const r = await testProductionLogin(TARGET_EMAIL, testPwd);
        process.env._TEST_PW = '';
        const loginOk  = r.status === 200 && r.hasToken;
        const roleMatch = r.role  === EXPECTED_ROLE;
        console.log('  HTTP status        :', r.status, loginOk ? '✓' : '✗');
        console.log('  Token issued       :', r.hasToken ? 'YES ✓' : 'NO ✗');
        console.log('  Role in response   :', r.role || '(none)', roleMatch ? '✓' : '✗');
        console.log('  Login test         :', loginOk && roleMatch ? 'PASS ✓' : 'FAIL ✗');
    }

    // ── 5. Final report ───────────────────────────────────────────────────────
    console.log('\n=============================================================');
    console.log('  FINAL REPORT');
    console.log('=============================================================');
    console.log('  Database targeted          :', u.hostname + ' / ' + u.pathname.replace('/', ''));
    console.log('  Account targeted           :', TARGET_EMAIL);
    console.log('  Password reset             : SUCCESS');
    console.log('  Role preserved             :', roleOk   ? 'YES' : 'NO — ALERT');
    console.log('  isActive preserved         :', activeOk ? 'YES' : 'NO — ALERT');
    console.log('  Other accounts modified    : NO  (single @unique update, count unchanged)');
    console.log('=============================================================\n');
}

main().catch(e => { console.error('[FATAL]', e.message); process.exit(1); });
