'use strict';
const https = require('https');

function testLogin(email, password) {
    return new Promise((resolve) => {
        const bodyStr = JSON.stringify({ email, password });
        const req = https.request({
            hostname: 'api.sitam.co.in',
            port: 443,
            path: '/api/admin/auth/login',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(bodyStr)
            }
        }, res => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => resolve({ status: res.statusCode, data }));
        });
        req.on('error', err => resolve({ status: 500, data: err.message }));
        req.write(bodyStr);
        req.end();
    });
}

async function main() {
    console.log('Testing Admin Login on https://api.sitam.co.in...');
    const res1 = await testLogin('admin@sitamecap.co.in', 'Admin@SITAM2024');
    console.log('Admin@SITAM2024 Status:', res1.status, res1.data.slice(0, 100));

    console.log('\nTesting Guard Login on https://api.sitam.co.in...');
    const res2 = await testLogin('guard@sitamecap.co.in', 'Guard@SITAM2024');
    console.log('Guard@SITAM2024 Status:', res2.status, res2.data.slice(0, 100));
}

main();
