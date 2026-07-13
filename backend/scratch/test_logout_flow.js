const http = require('http');

function req(method, path, body, headers = {}) {
    return new Promise((resolve, reject) => {
        const payload = body ? JSON.stringify(body) : null;
        const options = {
            hostname: 'localhost',
            port: 3001,
            path,
            method,
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': payload ? Buffer.byteLength(payload) : 0,
                ...headers
            }
        };
        const r = http.request(options, res => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
                catch (_) { resolve({ status: res.statusCode, body: data }); }
            });
        });
        r.on('error', reject);
        if (payload) r.write(payload);
        r.end();
    });
}

async function test() {
    console.log('--- TEST LOGOUT FLOW ---');

    // 1. Login
    console.log('1. Logging in as STUDENT001...');
    const loginRes = await req('POST', '/api/auth/login', {
        userId: 'STUDENT001',
        password: 'password123'
    });

    if (loginRes.status !== 200 || !loginRes.body.token) {
        console.error('Failed to log in:', loginRes.status, loginRes.body);
        process.exit(1);
    }
    const token = loginRes.body.token;
    console.log('   ✓ Logged in. Token received:', token.substring(0, 8) + '...');

    const authHeaders = { 'Authorization': `Bearer ${token}` };

    // 2. Fetch profile (expect success)
    console.log('2. Fetching profile with token...');
    const profileRes = await req('GET', '/api/profile', null, authHeaders);
    if (profileRes.status !== 200) {
        console.error('Failed to fetch profile:', profileRes.status, profileRes.body);
        process.exit(1);
    }
    console.log('   ✓ Profile fetched successfully (200). Name:', profileRes.body.profile?.name);

    // 3. Logout
    console.log('3. Logging out...');
    const logoutRes = await req('POST', '/api/auth/logout', null, authHeaders);
    if (logoutRes.status !== 200 || logoutRes.body.success !== true) {
        console.error('Logout failed:', logoutRes.status, logoutRes.body);
        process.exit(1);
    }
    console.log('   ✓ Logout API call returned success (200).');

    // 4. Fetch profile again (expect 401)
    console.log('4. Attempting to fetch profile with invalidated token...');
    const profileRes2 = await req('GET', '/api/profile', null, authHeaders);
    if (profileRes2.status === 401) {
        console.log('   ✓ Token rejected with 401 (Unauthorized) as expected!');
        console.log('\n=== LOGOUT E2E TEST PASSED ✓ ===\n');
        process.exit(0);
    } else {
        console.error('   ✗ FAILED: Token was not invalidated! Got status:', profileRes2.status, profileRes2.body);
        process.exit(1);
    }
}

test().catch(e => {
    console.error('Test crashed:', e.message);
    process.exit(1);
});
