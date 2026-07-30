'use strict';
/**
 * SUPER ADMIN AUTH REPAIR VIA RAILWAY RUNTIME (Backend Location)
 * Reads process.env.ADMIN_PASSWORD_SALT (injected by Railway runtime)
 * Reads process.env._SA_PW (supplied securely in memory)
 * Updates Admin.passwordHash for admin@sitamecap.co.in
 * Verifies live HTTP login and 30-second session stability.
 * 
 * STRICT SAFEGUARDS:
 * 1. Target email is strictly 'admin@sitamecap.co.in'
 * 2. Pre-check asserts role === 'SUPER_ADMIN' and isActive === true
 * 3. Asserts process.env.ADMIN_PASSWORD_SALT exists and is non-empty
 * 4. Asserts updateResult.count === 1 (exactly 1 record updated)
 * 5. NEVER prints passwords, salts, hashes, DATABASE_URL, or JWTs.
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
    console.log('  SUPER ADMIN AUTH REPAIR — RAILWAY RUNTIME EXECUTION');
    console.log('=============================================================\n');

    // 1. Verify Railway injected env vars
    const salt = process.env.ADMIN_PASSWORD_SALT;
    const dbUrl = process.env.DATABASE_URL;
    const newPassword = process.env._SA_PW;

    console.log('RAILWAY_SALT_PRESENT:', !!(salt && salt.trim()));
    console.log('DATABASE_URL_PRESENT:', !!(dbUrl && dbUrl.trim()));
    console.log('PASSWORD_INPUT_PRESENT:', !!(newPassword && newPassword.trim()));

    if (!salt || !salt.trim()) {
        console.error('[FATAL] ADMIN_PASSWORD_SALT not present in Railway runtime.');
        process.exit(1);
    }
    if (!dbUrl || !dbUrl.trim()) {
        console.error('[FATAL] DATABASE_URL not present in Railway runtime.');
        process.exit(1);
    }
    if (!newPassword || !newPassword.trim()) {
        console.error('[FATAL] _SA_PW not provided in memory.');
        process.exit(1);
    }

    // 2. Hash using Railway salt
    const newHash = crypto.createHmac('sha256', salt).update(newPassword).digest('hex');
    // Clear password env var in process memory
    process.env._SA_PW = '';

    if (newHash.length !== 64) {
        console.error('[FATAL] Generated hash length is invalid.');
        process.exit(1);
    }
    console.log('HASH_GENERATED_WITH_RAILWAY_SALT: YES (64 hex chars)');

    // 3. Connect to DB and update exactly 1 record
    const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });
    try {
        const adminBefore = await prisma.admin.findUnique({ where: { email: TARGET_EMAIL } });
        if (!adminBefore) {
            console.error('[FATAL] Pre-update verification failed. Account missing.');
            process.exit(1);
        }
        if (adminBefore.role !== 'SUPER_ADMIN') {
            console.error(`[FATAL] Role is '${adminBefore.role}', expected 'SUPER_ADMIN'.`);
            process.exit(1);
        }
        if (!adminBefore.isActive) {
            console.error('[FATAL] Account isActive is false.');
            process.exit(1);
        }

        const updateResult = await prisma.admin.updateMany({
            where: { email: TARGET_EMAIL, role: 'SUPER_ADMIN' },
            data: { passwordHash: newHash }
        });

        console.log('RECORDS_UPDATED:', updateResult.count);
        if (updateResult.count !== 1) {
            console.error('[FATAL] Expected exactly 1 record updated, got ' + updateResult.count);
            process.exit(1);
        }

        const adminAfter = await prisma.admin.findUnique({ where: { email: TARGET_EMAIL } });
        const hashConfirmed = adminAfter && adminAfter.passwordHash === newHash;
        console.log('HASH_CONFIRMED_IN_DB:', hashConfirmed ? 'YES' : 'NO');
        if (!hashConfirmed) {
            console.error('[FATAL] DB hash verification failed.');
            process.exit(1);
        }

        // 4. Test live login against Railway backend
        console.log('\nTesting live POST /api/admin/auth/login...');
        const loginRes = await httpPost(RAILWAY_HOST, '/api/admin/auth/login', {
            email: TARGET_EMAIL,
            password: newPassword
        });

        console.log('LOGIN_STATUS:', loginRes.status);
        console.log('LOGIN_SUCCESS:', loginRes.status === 200 ? 'YES' : 'NO');
        console.log('JWT_RECEIVED:', !!(loginRes.body?.token));

        if (loginRes.status !== 200 || !loginRes.body?.token) {
            console.error('[FATAL] Live login failed after DB update.');
            process.exit(1);
        }

        const token = loginRes.body.token;

        // 5. Test 30s session stability
        console.log('\nTesting session stability (T+0, T+5, T+15, T+30)...');
        const t0 = await httpGet(RAILWAY_HOST, '/api/admin/staff', token);
        console.log('T+0:', t0.status === 200 ? '200 OK' : `HTTP ${t0.status}`);

        await new Promise(r => setTimeout(r, 5000));
        const t5 = await httpGet(RAILWAY_HOST, '/api/admin/staff', token);
        console.log('T+5:', t5.status === 200 ? '200 OK' : `HTTP ${t5.status}`);

        await new Promise(r => setTimeout(r, 10000));
        const t15 = await httpGet(RAILWAY_HOST, '/api/admin/staff', token);
        console.log('T+15:', t15.status === 200 ? '200 OK' : `HTTP ${t15.status}`);

        await new Promise(r => setTimeout(r, 15000));
        const t30 = await httpGet(RAILWAY_HOST, '/api/admin/staff', token);
        console.log('T+30:', t30.status === 200 ? '200 OK' : `HTTP ${t30.status}`);

        const sessionStable = [t0, t5, t15, t30].every(r => r.status === 200);
        console.log('\nSESSION_STABILITY_PASSED:', sessionStable ? 'YES' : 'NO');

        if (sessionStable) {
            console.log('\n=============================================================');
            console.log('  SUPER ADMIN AUTH REPAIR COMPLETE AND VERIFIED');
            console.log('=============================================================');
        } else {
            process.exit(1);
        }

    } finally {
        await prisma.$disconnect();
    }
}

main().catch(err => {
    console.error('[FATAL]', err.message);
    process.exit(1);
});
