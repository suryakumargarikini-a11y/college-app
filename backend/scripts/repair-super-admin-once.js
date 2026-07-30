'use strict';
/**
 * SITAM Smart ERP — One-Time Production Super Admin Password Repair
 * File: D:\111\backend\scripts\repair-super-admin-once.js
 * 
 * Purpose:
 * Safely updates the passwordHash for admin@sitamecap.co.in using the
 * process.env.ADMIN_PASSWORD_SALT injected at runtime by Railway.
 * 
 * STRICT SECURITY CONSTRAINTS:
 * - Fail-closed if _SA_PW, ADMIN_PASSWORD_SALT, or DATABASE_URL are missing.
 * - Require target email === 'admin@sitamecap.co.in'.
 * - Require role === 'SUPER_ADMIN' and isActive === true.
 * - Hashes password using identical HMAC-SHA256 as authController.js.
 * - Immediately clears process.env._SA_PW from process memory.
 * - Enforces exactly 1 record updated.
 * - Modifies ZERO other fields, StaffScopes, or database tables.
 * - Never prints or logs passwords, salts, hashes, DATABASE_URL, or JWTs.
 * - Performs live login & 30s session stability verification against Railway.
 * - Disconnects Prisma in finally.
 */

const crypto = require('crypto');
const https = require('https');
const { PrismaClient } = require('@prisma/client');

const TARGET_EMAIL = 'admin@sitamecap.co.in';
const RAILWAY_HOST = 'web-production-259f33.up.railway.app';

function httpPost(hostname, path_, body) {
    return new Promise((resolve, reject) => {
        const bodyStr = JSON.stringify(body);
        const req = https.request({
            hostname, path: path_, method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr) }
        }, res => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
                catch { resolve({ status: res.statusCode, body: data }); }
            });
        });
        req.on('error', reject);
        req.write(bodyStr);
        req.end();
    });
}

function httpGet(hostname, path_, token) {
    return new Promise((resolve, reject) => {
        const req = https.request({
            hostname, path: path_, method: 'GET',
            headers: { 'Authorization': `Bearer ${token}` }
        }, res => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
                catch { resolve({ status: res.statusCode, body: data }); }
            });
        });
        req.on('error', reject);
        req.end();
    });
}

async function main() {
    console.log('=============================================================');
    console.log('  SITAM SMART ERP — SUPER ADMIN AUTH REPAIR (ONE-TIME)');
    console.log('=============================================================\n');

    // 1. Fail-closed environment validation
    const salt = process.env.ADMIN_PASSWORD_SALT;
    const dbUrl = process.env.DATABASE_URL;
    const newPassword = process.env._SA_PW;

    console.log('SANITIZED_ENV_CHECK:');
    console.log('  ADMIN_PASSWORD_SALT_PRESENT:', !!(salt && salt.trim()));
    console.log('  DATABASE_URL_PRESENT:', !!(dbUrl && dbUrl.trim()));
    console.log('  _SA_PW_INPUT_PRESENT:', !!(newPassword && newPassword.trim()));

    if (!salt || !salt.trim()) {
        console.error('\n[FATAL_FAIL_CLOSED] ADMIN_PASSWORD_SALT environment variable missing or empty.');
        process.exit(1);
    }
    if (!dbUrl || !dbUrl.trim()) {
        console.error('\n[FATAL_FAIL_CLOSED] DATABASE_URL environment variable missing or empty.');
        process.exit(1);
    }
    if (!newPassword || !newPassword.trim()) {
        console.error('\n[FATAL_FAIL_CLOSED] _SA_PW environment variable missing or empty in memory.');
        process.exit(1);
    }

    // 2. Sanitized DB target host print
    try {
        const u = new URL(dbUrl);
        console.log('  DATABASE_HOST:', u.hostname);
        console.log('  DATABASE_NAME:', u.pathname.replace(/^\//, ''));
    } catch (e) {
        console.error('\n[FATAL_FAIL_CLOSED] Could not parse DATABASE_URL hostname.');
        process.exit(1);
    }

    // 3. Generate HMAC-SHA256 hash (identical to authController.js) & clear _SA_PW
    const newHash = crypto.createHmac('sha256', salt).update(newPassword).digest('hex');
    process.env._SA_PW = ''; // Immediate in-memory clearing

    if (!newHash || newHash.length !== 64) {
        console.error('\n[FATAL_FAIL_CLOSED] HMAC-SHA256 generation output invalid length.');
        process.exit(1);
    }
    console.log('\nHASH_GENERATION:');
    console.log('  ALGORITHM: HMAC-SHA256 (identical to authController.js) ✓');
    console.log('  HASH_LENGTH: 64 hex chars ✓');
    console.log('  MEMORY_CLEARED: _SA_PW reset to empty string ✓\n');

    // 4. Database Pre-mutation Guard Audit
    const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });
    try {
        console.log('TARGET_PRE_CHECK:');
        const adminBefore = await prisma.admin.findUnique({
            where: { email: TARGET_EMAIL },
            select: { id: true, email: true, role: true, isActive: true }
        });

        console.log('  TARGET_EMAIL_EXACT:', TARGET_EMAIL);
        console.log('  ACCOUNT_FOUND:', !!adminBefore);

        if (!adminBefore) {
            console.error(`\n[FATAL_FAIL_CLOSED] Account '${TARGET_EMAIL}' not found in database.`);
            process.exit(1);
        }

        console.log('  ROLE_EXACT_MATCH:', adminBefore.role === 'SUPER_ADMIN' ? 'SUPER_ADMIN ✓' : `FAIL (${adminBefore.role})`);
        console.log('  IS_ACTIVE_TRUE:', adminBefore.isActive === true ? 'true ✓' : 'false ✗');

        if (adminBefore.role !== 'SUPER_ADMIN') {
            console.error(`\n[FATAL_FAIL_CLOSED] Role is '${adminBefore.role}', expected 'SUPER_ADMIN'.`);
            process.exit(1);
        }
        if (!adminBefore.isActive) {
            console.error('\n[FATAL_FAIL_CLOSED] Account isActive is false.');
            process.exit(1);
        }

        // 5. Update ONLY passwordHash for that exact record
        console.log('\nEXECUTING_DATABASE_MUTATION:');
        const updateResult = await prisma.admin.updateMany({
            where: { id: adminBefore.id, email: TARGET_EMAIL, role: 'SUPER_ADMIN' },
            data: { passwordHash: newHash }
        });

        console.log('  AFFECTED_ROW_COUNT:', updateResult.count);
        if (updateResult.count !== 1) {
            console.error(`\n[FATAL_FAIL_CLOSED] Expected exactly 1 record updated, got ${updateResult.count}.`);
            process.exit(1);
        }
        console.log('  EXACTLY_ONE_ROW_UPDATED: YES ✓');

        // Post-update DB confirmation
        const adminAfter = await prisma.admin.findUnique({
            where: { id: adminBefore.id },
            select: { passwordHash: true }
        });
        const hashMatchesDb = adminAfter && adminAfter.passwordHash === newHash;
        console.log('  HASH_VERIFIED_IN_DB:', hashMatchesDb ? 'YES ✓' : 'NO ✗');
        if (!hashMatchesDb) {
            console.error('\n[FATAL_FAIL_CLOSED] Post-update DB hash verification failed.');
            process.exit(1);
        }

        // 6. Live Login Verification against Production Backend
        console.log('\nLIVE_PRODUCTION_LOGIN_TEST:');
        const loginRes = await httpPost(RAILWAY_HOST, '/api/admin/auth/login', {
            email: TARGET_EMAIL,
            password: newPassword
        });

        console.log('  LOGIN_HTTP_STATUS:', loginRes.status);
        const loginSuccess = loginRes.status === 200 && !!loginRes.body?.token;
        console.log('  LOGIN_SUCCESS:', loginSuccess ? 'YES ✓' : 'NO ✗');

        const returnedRole = loginRes.body?.admin?.role || loginRes.body?.role;
        console.log('  RETURNED_ROLE_SUPER_ADMIN:', returnedRole === 'SUPER_ADMIN' ? 'SUPER_ADMIN ✓' : `FAIL (${returnedRole})`);

        if (!loginSuccess || returnedRole !== 'SUPER_ADMIN') {
            console.error('\n[FATAL_FAIL_CLOSED] Live production login test failed.');
            process.exit(1);
        }

        const inMemoryJwt = loginRes.body.token;

        // 7. Session Stability Verification (T+0, T+5, T+15, T+30)
        console.log('\nSESSION_STABILITY_VERIFICATION:');

        const t0 = await httpGet(RAILWAY_HOST, '/api/admin/staff', inMemoryJwt);
        console.log('  T+0s  protected endpoint status:', t0.status === 200 ? 'HTTP 200 PASS ✓' : `HTTP ${t0.status} FAIL`);

        await new Promise(r => setTimeout(r, 5000));
        const t5 = await httpGet(RAILWAY_HOST, '/api/admin/staff', inMemoryJwt);
        console.log('  T+5s  protected endpoint status:', t5.status === 200 ? 'HTTP 200 PASS ✓' : `HTTP ${t5.status} FAIL`);

        await new Promise(r => setTimeout(r, 10000));
        const t15 = await httpGet(RAILWAY_HOST, '/api/admin/staff', inMemoryJwt);
        console.log('  T+15s protected endpoint status:', t15.status === 200 ? 'HTTP 200 PASS ✓' : `HTTP ${t15.status} FAIL`);

        await new Promise(r => setTimeout(r, 15000));
        const t30 = await httpGet(RAILWAY_HOST, '/api/admin/staff', inMemoryJwt);
        console.log('  T+30s protected endpoint status:', t30.status === 200 ? 'HTTP 200 PASS ✓' : `HTTP ${t30.status} FAIL`);

        const sessionStable = [t0, t5, t15, t30].every(r => r.status === 200);
        console.log('\nSESSION_STABLE_30S:', sessionStable ? 'PASS ✓' : 'FAIL 成果');

        if (!sessionStable) {
            console.error('\n[FATAL_FAIL_CLOSED] Session stability test failed.');
            process.exit(1);
        }

        console.log('\n=============================================================');
        console.log('  SUPER ADMIN AUTH REPAIR COMPLETE & VERIFIED SUCCESSFULLY');
        console.log('=============================================================');

    } finally {
        await prisma.$disconnect();
    }
}

main().catch(err => {
    console.error('\n[FATAL_ERROR]', err.message);
    process.exit(1);
});
