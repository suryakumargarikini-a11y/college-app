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

async function verify() {
    console.log('[Verify] Logging in to Render API...');
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

        console.log(`[Verify] Login Status: ${loginRes.status}`);
        console.log(`[Verify] Login Body: ${loginRes.data}`);

        const body = JSON.parse(loginRes.data);
        const token = body.data?.token || body.token;
        if (!token) {
            console.error('[Verify] No token returned!');
            return;
        }

        console.log(`[Verify] Received Token: ${token}`);
        console.log('[Verify] Fetching Profile...');

        const profileRes = await request({
            hostname: 'college-app-bx6b.onrender.com',
            path: '/api/profile',
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        console.log(`[Verify] Profile Status: ${profileRes.status}`);
        const profileObj = JSON.parse(profileRes.data).data || {};
        delete profileObj.marks;
        delete profileObj.attendance;
        delete profileObj.timetable;
        delete profileObj.notifications;
        delete profileObj.fees;
        delete profileObj.assignments;
        console.log('[Verify] Profile core properties from API:');
        console.log(JSON.stringify(profileObj, null, 2));

    } catch (e) {
        console.error('[Verify] Error:', e);
    }
}

verify();
