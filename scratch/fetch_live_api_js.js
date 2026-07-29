const https = require('https');

// The live Vercel bundle has api-cKiR3jZq.js (different hash than local api-Si7aqwsr.js)
// This confirms Vercel built its OWN version during CI/CD
// Fetch the LIVE api chunk to see the actual baseURL
https.get('https://college-app-ivory-alpha.vercel.app/assets/api-cKiR3jZq.js', (res) => {
    let d = '';
    res.on('data', c => d += c);
    res.on('end', () => {
        console.log('[LIVE-API-JS] HTTP Status:', res.statusCode);
        console.log('[LIVE-API-JS] Size:', d.length);
        console.log('[LIVE-API-JS] Full content:');
        console.log(d);
    });
}).on('error', err => console.error('[LIVE-API-JS] Error:', err.message));
