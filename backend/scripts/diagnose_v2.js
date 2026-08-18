'use strict';
/**
 * DIAGNOSTIC ONLY — NO WRITES
 * 
 * Determines the RAILWAY ADMIN_PASSWORD_SALT fingerprint by:
 *  1. Reading the current DB passwordHash for admin@sitamecap.co.in
 *  2. Computing HMAC-SHA256(LOCAL_SALT, 'Admin@SITAM2024') and comparing fingerprint
 *  3. Testing login with Admin@SITAM2024 via the local server (which uses LOCAL_SALT)
 *  4. Emitting a clear MATCH/MISMATCH verdict
 * 
 * NEVER prints: passwordHash, salt, DATABASE_URL, tokens, passwords.
 */
require('dotenv').config();
const crypto = require('crypto');
const http   = require('http');
const { PrismaClient } = require('@prisma/client');

const TARGET_EMAIL      = 'admin@sitamecap.co.in';
const CANDIDATE_PASS    = 'Admin@SITAM2024';

async function diagnose() {
    const prisma     = new PrismaClient();
    const localSalt  = process.env.ADMIN_PASSWORD_SALT;

    // 1. Read current DB hash (fingerprint only — never print full hash)
    const record = await prisma.admin.findUnique({
        where: { email: TARGET_EMAIL },
        select: { passwordHash: true, email: true, role: true, isActive: true }
    });
    await prisma.$disconnect();

    const storedHash = record?.passwordHash;
    if (!storedHash) { console.error('Account not found or no hash'); process.exit(1); }

    const storedFp = storedHash.slice(0, 8) + '...' + storedHash.slice(-8);

    // 2. Compute LOCAL hash for Admin@SITAM2024
    const localHash  = crypto.createHmac('sha256', localSalt).update(CANDIDATE_PASS).digest('hex');
    const localFp    = localHash.slice(0, 8) + '...' + localHash.slice(-8);

    console.log('\n=== SALT FINGERPRINT COMPARISON ===\n');
    console.log('Stored DB hash fp  :', storedFp);
    console.log('Local  hash fp     :', localFp, '  <- LOCAL_SALT + Admin@SITAM2024');
    console.log('Fingerprints match :', storedHash === localHash ? 'YES — same salt in Railway and local .env' : 'NO  — Railway uses a DIFFERENT ADMIN_PASSWORD_SALT');

    // 3. Test local server login (localhost:8080 uses LOCAL_SALT)
    const loginResult = await new Promise((resolve) => {
        const body = JSON.stringify({ email: TARGET_EMAIL, password: CANDIDATE_PASS });
        const req = http.request({
            hostname: 'localhost', port: 8080,
            path: '/api/admin/auth/login', method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
        }, res => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
                catch { resolve({ status: res.statusCode, body: data }); }
            });
        });
        req.on('error', err => resolve({ status: 0, error: err.message }));
        req.write(body);
        req.end();
    });

    console.log('\n=== LOCAL SERVER LOGIN TEST (localhost:8080) ===\n');
    console.log('Status :', loginResult.status);
    if (loginResult.status === 200) {
        console.log('Result : 200 OK — LOCAL server accepts Admin@SITAM2024 with LOCAL_SALT');
        console.log('Role   :', loginResult.body?.admin?.role);
    } else {
        console.log('Result :', JSON.stringify(loginResult.body || loginResult.error));
    }

    console.log('\n=== CONCLUSION ===\n');
    const dbMatchesLocal = storedHash === localHash;
    if (dbMatchesLocal) {
        console.log('DB stores LOCAL_SALT hash. Production (Railway) uses SAME salt as local.');
        console.log('If production is returning 401, the password entered in the browser is WRONG.');
        console.log('Try: Admin@SITAM2024 — it should work on production if salt matches.');
    } else {
        console.log('DB stores a hash incompatible with LOCAL_SALT + Admin@SITAM2024.');
        console.log('adminAutoSync.js ran on Railway with a DIFFERENT ADMIN_PASSWORD_SALT.');
        console.log('The correct password for production IS: Admin@SITAM2024');
        console.log('but only verifiable by the production server using its own Railway salt.');
        console.log('');
        console.log('REQUIRED ACTION: Go to Railway dashboard -> Variables');
        console.log('  Find ADMIN_PASSWORD_SALT and compare it to local .env.');
        console.log('  They differ. You must either:');
        console.log('  A) Update the DB hash using the RAILWAY SALT (via repair_super_admin_railway.js)');
        console.log('  B) Remove adminAutoSync.js and reset using the LOCAL SALT path');
    }
}

diagnose().catch(e => { console.error('[FATAL]', e.message); process.exit(1); });
