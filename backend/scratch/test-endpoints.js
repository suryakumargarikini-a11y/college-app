const https = require('https');

const endpoints = [
    'https://college-app-production-0fd2.up.railway.app/api/health/liveness',
    'https://college-app-production-0fd2.up.railway.app/api/health/readiness',
    'https://college-app-production-0fd2.up.railway.app/api/placements',
    'https://college-app-production-0fd2.up.railway.app/api/surveys',
    'https://college-app-production-0fd2.up.railway.app/api/help-desk',
    'https://college-app-production-0fd2.up.railway.app/api/lost-found'
];

function ping(url) {
    return new Promise((resolve) => {
        const start = Date.now();
        https.get(url, { timeout: 15000 }, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                const duration = Date.now() - start;
                resolve({
                    url,
                    statusCode: res.statusCode,
                    duration: `${duration}ms`,
                    sample: data.slice(0, 150)
                });
            });
        }).on('error', (err) => {
            resolve({
                url,
                error: err.message
            });
        }).on('timeout', () => {
            resolve({
                url,
                error: 'Timeout (15s exceeded)'
            });
        });
    });
}

async function run() {
    console.log('Pinging Render backend endpoints... (Waking up instance)');
    for (const url of endpoints) {
        console.log(`Ping -> ${url}`);
        const result = await ping(url);
        console.log('Result:', JSON.stringify(result, null, 2));
    }
}

run();
