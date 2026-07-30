'use strict';
const https = require('https');

const domains = [
    'web-production-259f33.up.railway.app',
    'sitam-backend-production.up.railway.app',
    'sitam-erp-production.up.railway.app',
    'college-app.up.railway.app',
    'sitam-api.up.railway.app'
];

async function checkDomain(domain) {
    return new Promise((resolve) => {
        const req = https.get(`https://${domain}/api/health/liveness`, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                console.log(`[${domain}] GET /api/health/liveness -> Status: ${res.statusCode} | Body: ${body.slice(0, 120)}`);
                resolve({ domain, status: res.statusCode, body });
            });
        });
        req.on('error', (err) => {
            console.log(`[${domain}] Error: ${err.message}`);
            resolve({ domain, status: 0, error: err.message });
        });
    });
}

async function run() {
    console.log('Searching active Railway backend domain...');
    for (const d of domains) {
        await checkDomain(d);
    }
}

run();
