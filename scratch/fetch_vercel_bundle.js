const https = require('https');

// Fetch the LIVE Vercel main JS bundle to find the api baseURL
https.get('https://college-app-ivory-alpha.vercel.app/assets/index-uyeOaFFX.js', (res) => {
    let d = '';
    res.on('data', c => d += c);
    res.on('end', () => {
        console.log('[VERCEL-BUNDLE] HTTP Status:', res.statusCode);
        console.log('[VERCEL-BUNDLE] Bundle size:', d.length, 'chars');
        
        const localhostIdx = d.indexOf('localhost');
        const railwayIdx = d.indexOf('web-production');
        const railwayApp = d.indexOf('railway.app');
        const apiBase = d.indexOf('VITE_API');
        
        console.log('\n--- API BASE URL ANALYSIS ---');
        console.log('[VERCEL-BUNDLE] localhost found at:', localhostIdx);
        if (localhostIdx > -1) console.log('[VERCEL-BUNDLE] localhost context:', d.substring(localhostIdx - 50, localhostIdx + 100));
        
        console.log('[VERCEL-BUNDLE] web-production found at:', railwayIdx);
        if (railwayIdx > -1) console.log('[VERCEL-BUNDLE] railway context:', d.substring(railwayIdx - 50, railwayIdx + 100));
        
        console.log('[VERCEL-BUNDLE] railway.app found at:', railwayApp);
        console.log('[VERCEL-BUNDLE] VITE_API reference found at:', apiBase);
        
        // Find the DEV_FALLBACK constant
        const devFallbackIdx = d.indexOf('http://localhost:3001');
        console.log('[VERCEL-BUNDLE] DEV_FALLBACK http://localhost:3001 at:', devFallbackIdx);
        if (devFallbackIdx > -1) {
            console.log('[VERCEL-BUNDLE] DEV_FALLBACK context:', d.substring(devFallbackIdx - 50, devFallbackIdx + 100));
        }
        
        // Find any baseURL configuration
        const baseURLIdx = d.indexOf('baseURL:');
        if (baseURLIdx > -1) {
            // Find all baseURL occurrences
            let idx = 0;
            let count = 0;
            while ((idx = d.indexOf('baseURL:', idx)) !== -1 && count < 5) {
                console.log('[VERCEL-BUNDLE] baseURL at', idx, ':', d.substring(idx - 20, idx + 100));
                idx += 8;
                count++;
            }
        }
    });
}).on('error', err => console.error('[VERCEL-BUNDLE] Error:', err.message));
