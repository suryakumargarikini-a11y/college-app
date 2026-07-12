const https = require('https');

function request(options, postData = null) {
    return new Promise((resolve, reject) => {
        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                resolve({
                    status: res.statusCode,
                    headers: res.headers,
                    data: data
                });
            });
        });
        req.on('error', reject);
        if (postData) {
            req.write(JSON.stringify(postData));
        }
        req.end();
    });
}

async function trigger() {
    console.log('[Sync] Logging in to Render API...');
    try {
        const loginRes = await request({
            hostname: 'college-app-bx6b.onrender.com',
            path: '/api/auth/login',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        }, {
            userId: '25B61A0596',
            password: 'webcap'
        });

        console.log(`[Sync] Login Status: ${loginRes.status}`);
        const body = JSON.parse(loginRes.data);
        const token = body.data?.token || body.token;
        if (!token) {
            console.error('[Sync] No token returned!');
            return;
        }

        console.log(`[Sync] Received Token: ${token}`);
        console.log('[Sync] Triggering Manual Sync via POST /api/sync...');

        const syncRes = await request({
            hostname: 'college-app-bx6b.onrender.com',
            path: '/api/sync',
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        console.log(`[Sync] Trigger Status: ${syncRes.status}`);
        console.log(`[Sync] Trigger Response: ${syncRes.data}`);

    } catch (e) {
        console.error('[Sync] Error:', e);
    }
}

trigger();
