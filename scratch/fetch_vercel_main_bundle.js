const https = require('https');

// The main bundle (index-uyeOaFFX.js) is the entry, but api.js is a separate chunk
// We need to find what chunk contains the axios api configuration
// Let's search the main bundle for imports or dynamic imports
https.get('https://college-app-ivory-alpha.vercel.app/assets/index-uyeOaFFX.js', (res) => {
    let d = '';
    res.on('data', c => d += c);
    res.on('end', () => {
        console.log('[MAIN-BUNDLE] Size:', d.length);
        
        // Look for dynamic imports / chunk references
        const importMatches = d.match(/import\("[^"]+"\)/g) || [];
        console.log('[MAIN-BUNDLE] Dynamic imports:', importMatches.slice(0, 20));
        
        // Look for chunk filenames
        const assetMatches = d.match(/assets\/[a-zA-Z0-9_-]+\.js/g) || [];
        console.log('[MAIN-BUNDLE] Asset references:', [...new Set(assetMatches)].slice(0, 30));
        
        // Also check if api is inlined in main bundle
        const apiIdx = d.indexOf('/admin/auth/login');
        const axiosIdx = d.indexOf('axio');
        const baseURLIdx = d.indexOf('baseURL');
        console.log('[MAIN-BUNDLE] /admin/auth/login at:', apiIdx);
        if (apiIdx > -1) console.log('[MAIN-BUNDLE] context:', d.substring(apiIdx - 100, apiIdx + 100));
        console.log('[MAIN-BUNDLE] axios at:', axiosIdx);
        console.log('[MAIN-BUNDLE] baseURL at:', baseURLIdx);
        if (baseURLIdx > -1) console.log('[MAIN-BUNDLE] baseURL context:', d.substring(baseURLIdx - 50, baseURLIdx + 100));
    });
}).on('error', err => console.error('[MAIN-BUNDLE] Error:', err.message));
