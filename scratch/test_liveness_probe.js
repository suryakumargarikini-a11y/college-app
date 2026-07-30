'use strict';

const http = require('http');

async function testLiveness() {
    process.stdout.write('Testing GET /api/health/liveness endpoint...\n');

    return new Promise((resolve, reject) => {
        const req = http.get('http://localhost:8080/api/health/liveness', (res) => {
            let data = '';
            res.on('data', chunk => { data += chunk; });
            res.on('end', () => {
                console.log(`HTTP Status: ${res.statusCode}`);
                console.log(`Response  : ${data}`);
                if (res.statusCode === 200) {
                    process.stdout.write('✅ Liveness Probe Test: SUCCESS\n');
                    resolve(true);
                } else {
                    process.stdout.write(`❌ Liveness Probe Test: FAILED (${res.statusCode})\n`);
                    reject(new Error(`Unexpected status ${res.statusCode}`));
                }
            });
        });
        req.on('error', (err) => {
            console.error(`HTTP Connection Error: ${err.message}`);
            reject(err);
        });
    });
}

testLiveness().then(() => process.exit(0)).catch(() => process.exit(1));
