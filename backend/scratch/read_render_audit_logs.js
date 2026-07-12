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

async function readLogs() {
    console.log('[Logs] Logging in to Render API...');
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

        const body = JSON.parse(loginRes.data);
        const token = body.data?.token || body.token;
        if (!token) {
            console.error('[Logs] No token returned!');
            return;
        }

        console.log(`[Logs] Received Token: ${token}`);
        console.log('[Logs] Fetching Audit Logs via GET /api/sync/debug...');

        const logsRes = await request({
            hostname: 'college-app-bx6b.onrender.com',
            path: '/api/sync/debug',
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        console.log(`[Logs] Status: ${logsRes.status}`);
        console.log('[Logs] Response Body:');
        console.log(JSON.stringify(JSON.parse(logsRes.data), null, 2));

    } catch (e) {
        console.error('[Logs] Error:', e);
    }
}

readLogs();
