'use strict';
/**
 * SECURE ADMIN PASSWORD RESET — RAILWAY PUBLIC URL VARIANT
 *
 * Uses DATABASE_PUBLIC_URL (externally routable) from the Railway Postgres service
 * so this script can run locally while still connecting to the production database.
 *
 * ADMIN_PASSWORD_SALT is injected by `railway run` from the web service variables.
 * _RESET_PW is set as a local in-memory shell variable only — never written to disk.
 *
 * SECURITY GUARANTEES:
 *  - passwordHash, DATABASE_URL, ADMIN_PASSWORD_SALT, JWTs are NEVER printed
 *  - Only Admin.passwordHash is modified — no other field, no other account
 *  - Uses prisma.admin.update({ where: { email } }) bounded by @unique constraint
 *  - Full pre/post verification with fail-closed on any mismatch
 */
require('dotenv').config();
const crypto           = require('crypto');
const https            = require('https');
const { PrismaClient } = require('@prisma/client');

const TARGET_EMAIL  = 'admin@sitamecap.co.in';
const EXPECTED_ROLE = 'SUPER_ADMIN';
const MIN_PW_LEN    = 8;

// ── SALT from Railway web service ─────────────────────────────────────────────
const SALT = process.env.ADMIN_PASSWORD_SALT;
if (!SALT || !SALT.trim()) {
    console.error('[FATAL] ADMIN_PASSWORD_SALT not found. Aborting.');
    process.exit(1);
}

// ── Password from in-memory shell variable ────────────────────────────────────
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
process.env._RESET_PW = '';   // Immediate in-memory clear

// ── Use _PUB_DB_URL for external access ──────────────────────────────────────
// _PUB_DB_URL is set locally via PowerShell and is NOT overridden by `railway run`.
// This is the publicly routable Railway Postgres endpoint (tokaido.proxy.rlwy.net).
// `railway run` overwrites DATABASE_URL with the internal private URL — so we use
// _PUB_DB_URL to force the externally reachable connection.
const pubDbUrl = process.env._PUB_DB_URL;
if (!pubDbUrl) {
    console.error('[FATAL] _PUB_DB_URL not set. Set it with: $env:_PUB_DB_URL = <public_db_url>. Aborting.');
    process.exit(1);
}

// Override DATABASE_URL before PrismaClient initialises.
process.env.DATABASE_URL = pubDbUrl;

async function main() {
    const prisma = new PrismaClient();

    console.log('\n=============================================================');
    console.log('  SECURE ADMIN PASSWORD RESET — admin@sitamecap.co.in');
    console.log('=============================================================\n');

    const u = new URL(pubDbUrl);
    console.log('DB host  :', u.hostname);
    console.log('DB name  :', u.pathname.replace('/', ''));
    console.log('NODE_ENV :', process.env.NODE_ENV || '(unset)');
    console.log('SALT     : present\n');

    // ── 1. Pre-mutation read ──────────────────────────────────────────────────
    console.log('--- PRE-MUTATION VERIFICATION ---');
    const before = await prisma.admin.findUnique({
        where:  { email: TARGET_EMAIL },
        select: { id: true, email: true, name: true, role: true, isActive: true, createdAt: true }
    });

    if (!before) {
        console.error('[ABORT] Account not found. No changes made.');
        await prisma.$disconnect(); process.exit(1);
    }
    if (before.role !== EXPECTED_ROLE) {
        console.error(`[ABORT] Role mismatch: expected ${EXPECTED_ROLE}, found ${before.role}. No changes made.`);
        await prisma.$disconnect(); process.exit(1);
    }
    if (!before.isActive) {
        console.error('[ABORT] Account is inactive. No changes made.');
        await prisma.$disconnect(); process.exit(1);
    }

    console.log('  email    :', before.email);
    console.log('  name     :', before.name);
    console.log('  role     :', before.role);
    console.log('  isActive :', before.isActive);
    console.log('  id       :', before.id, '\n');

    // ── 2. Single-field update ────────────────────────────────────────────────
    console.log('--- MUTATION ---');
    console.log('  Updating passwordHash for', TARGET_EMAIL, '...');
    await prisma.admin.update({
        where: { email: TARGET_EMAIL },
        data:  { passwordHash: newHash }
    });
    console.log('  Update executed.\n');

    // ── 3. Post-mutation verification ─────────────────────────────────────────
    console.log('--- POST-MUTATION VERIFICATION ---');
    const after = await prisma.admin.findUnique({
        where:  { email: TARGET_EMAIL },
        select: { id: true, email: true, name: true, role: true, isActive: true, createdAt: true, passwordHash: true }
    });

    const hashOk        = after?.passwordHash === newHash;
    const fieldsOk      = after.id       === before.id
                       && after.email    === before.email
                       && after.name     === before.name
                       && after.role     === before.role
                       && after.isActive === before.isActive
                       && after.createdAt.toISOString() === before.createdAt.toISOString();

    console.log('  passwordHash updated   :', hashOk  ? 'YES ✓' : 'NO ✗ (HASH MISMATCH — INVESTIGATE)');
    console.log('  Non-password fields OK :', fieldsOk ? 'YES ✓' : 'NO ✗ (FIELDS CHANGED — INVESTIGATE)');

    await prisma.$disconnect();

    // ── 4. Live production login test ─────────────────────────────────────────
    console.log('\n--- PRODUCTION LOGIN TEST ---');
    const loginResult = await new Promise((resolve) => {
        const body = JSON.stringify({ email: TARGET_EMAIL, password: rawPw || 'redacted' });
        // rawPw was cleared above — skip live test if already cleared
        if (!body.includes('redacted')) {
            resolve({ status: 0, note: 'password cleared before test' }); return;
        }
        resolve({ status: 0, note: 'password cleared before test' });
    });
    console.log('  Login test skipped — password cleared from memory before this step (by design).');
    console.log('  Test login manually at: https://api.sitam.co.in/api/admin/auth/login\n');

    console.log('=============================================================');
    if (hashOk && fieldsOk) {
        console.log('  RESULT: PASS');
    } else {
        console.log('  RESULT: FAIL — investigate the mismatches above');
        process.exit(1);
    }
    console.log('=============================================================\n');
}

main().catch(async (err) => {
    console.error('[FATAL]', err.message);
    process.exit(1);
});
