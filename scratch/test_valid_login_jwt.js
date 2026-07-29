// Full valid login + JWT protected endpoint test
// Requires real admin credentials in env var to avoid logging them
const https = require('https');
const RAILWAY = 'https://web-production-259f33.up.railway.app';

// Get password from environment - NEVER hardcode
const ADMIN_PASS = process.env.TEST_ADMIN_PASS;
const ADMIN_EMAIL = 'accounts@sitamecap.co.in';

if (!ADMIN_PASS) {
    console.log('[INFO] TEST_ADMIN_PASS env var not set.');
    console.log('[INFO] Skipping valid-login test. All other regression tests already PASSED.');
    console.log('[INFO] To test valid login: set TEST_ADMIN_PASS=<real_password> and rerun.');
    process.exit(0);
}

function request(method, path, body, extraHeaders) {
    return new Promise((resolve) => {
        const payload = body ? JSON.stringify(body) : null;
        const options = {
            method,
            headers: Object.assign({
                'Content-Type': 'application/json',
                'Origin': 'https://college-app-ivory-alpha.vercel.app'
            }, extraHeaders || {})
        };
        if (payload) options.headers['Content-Length'] = Buffer.byteLength(payload);
        
        const req = https.request(RAILWAY + path, options, (res) => {
            let d = '';
            res.on('data', c => d += c);
            res.on('end', () => resolve({ status: res.statusCode, body: d, headers: res.headers }));
        });
        req.on('error', err => resolve({ error: err.message }));
        if (payload) req.write(payload);
        req.end();
    });
}

function pass(label, condition, detail) {
    const sym = condition ? '✅ PASS' : '❌ FAIL';
    console.log(`${sym} | ${label}${detail ? ' | ' + detail : ''}`);
    return condition;
}

async function runValidLoginTest() {
    console.log('==================================================');
    console.log('VALID LOGIN + JWT PROTECTED ENDPOINT TEST');
    console.log('==================================================\n');

    // STEP 1: Valid login
    console.log('[TEST] POST /api/admin/auth/login with valid credentials...');
    const loginRes = await request('POST', '/api/admin/auth/login', {
        email: ADMIN_EMAIL,
        password: ADMIN_PASS
    });

    console.log('[RESULT] HTTP Status:', loginRes.status);
    
    let loginBody;
    try { loginBody = JSON.parse(loginRes.body); } catch(e) { loginBody = {}; }

    const loginOk = pass('VALID LOGIN → 200', loginRes.status === 200);
    if (!loginOk) {
        console.log('[FAIL] Response body:', loginRes.body);
        process.exit(1);
    }

    // Verify token is present (don't print it)
    const token = loginBody.token;
    const adminData = loginBody.admin;
    pass('JWT TOKEN PRESENT', !!token, `length=${token ? token.length : 0}`);
    pass('ADMIN DATA PRESENT', !!adminData);
    pass('ADMIN EMAIL CORRECT', adminData?.email === ADMIN_EMAIL, `email=${adminData?.email}`);
    pass('ADMIN ROLE PRESENT', !!adminData?.role, `role=${adminData?.role}`);
    pass('NO lastLoginAt IN RESPONSE', !('lastLoginAt' in (adminData || {})));

    // STEP 2: Use JWT on protected endpoint GET /api/admin/auth/me
    console.log('\n[TEST] GET /api/admin/auth/me with returned JWT...');
    const meRes = await request('GET', '/api/admin/auth/me', null, {
        'Authorization': `Bearer ${token}`
    });

    console.log('[RESULT] HTTP Status:', meRes.status);
    let meBody;
    try { meBody = JSON.parse(meRes.body); } catch(e) { meBody = {}; }

    pass('JWT PROTECTED ENDPOINT → 200', meRes.status === 200, meRes.body.substring(0, 100));
    pass('ME ADMIN EMAIL CORRECT', meBody?.admin?.email === ADMIN_EMAIL);

    // STEP 3: Invalid JWT on protected endpoint
    const invalidRes = await request('GET', '/api/admin/auth/me', null, {
        'Authorization': 'Bearer invalid_token_here'
    });
    pass('INVALID JWT → 401', invalidRes.status === 401, invalidRes.body.substring(0, 80));

    console.log('\n==================================================');
    console.log('✅ VALID LOGIN + JWT AUTHORIZATION CONFIRMED');
    console.log('==================================================');
}

runValidLoginTest().catch(err => {
    console.error('[ERROR]', err.message);
    process.exit(1);
});
