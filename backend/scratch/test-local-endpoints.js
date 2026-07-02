const http = require('http');

const endpoints = [
    'http://localhost:3000/api/surveys',
    'http://localhost:3000/api/help-desk',
    'http://localhost:3000/api/lost-found',
    'http://localhost:3000/api/placements'
];

function ping(url) {
    return new Promise((resolve) => {
        const start = Date.now();
        http.get(url, (res) => {
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
        });
    });
}

async function run() {
    console.log('Pinging LOCAL backend endpoints (Port 3000)...');
    for (const url of endpoints) {
        console.log(`Ping -> ${url}`);
        const result = await ping(url);
        console.log('Result:', JSON.stringify(result, null, 2));
    }
}

run();
