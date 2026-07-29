const https = require('https');

// Fetch Vercel index.html to find actual deployed asset paths
https.get('https://college-app-ivory-alpha.vercel.app/', (res) => {
    let d = '';
    res.on('data', c => d += c);
    res.on('end', () => {
        console.log('[VERCEL-INDEX] HTTP Status:', res.statusCode);
        console.log('[VERCEL-INDEX] First 2000 chars:', d.substring(0, 2000));
        
        // Find script tags
        const scriptMatches = d.match(/src="[^"]+\.js"/g) || [];
        console.log('[VERCEL-INDEX] Script tags:', scriptMatches);
    });
}).on('error', err => console.error('[VERCEL-INDEX] Error:', err.message));
