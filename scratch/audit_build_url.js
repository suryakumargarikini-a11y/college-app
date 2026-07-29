// Audit baseURL baked into admin-portal production build
const fs = require('fs');
const content = fs.readFileSync('d:\\111\\admin-portal\\dist\\assets\\api-Si7aqwsr.js', 'utf8');

// Key findings from initial inspection of the built api.js:
// Mr="http://localhost:3001/api" -- this is the DEV_FALLBACK_API baked into the build
// The VITE_API_BASE_URL was EMPTY at build time, so the fallback was used

// Confirm the exact baseURL used in production build
const localhostIdx = content.indexOf('http://localhost:3001/api');
const railwayIdx = content.indexOf('web-production');

console.log('[BUILD-AUDIT] localhost:3001 found at position:', localhostIdx);
console.log('[BUILD-AUDIT] localhost:3001 context:', localhostIdx > -1 ? content.substring(localhostIdx - 30, localhostIdx + 60) : 'N/A');
console.log('[BUILD-AUDIT] Railway URL found at position:', railwayIdx);

// Check what VITE env variables were embedded
const viteEnvIdx = content.indexOf('import.meta.env');
console.log('[BUILD-AUDIT] import.meta.env reference in build:', viteEnvIdx > -1 ? content.substring(viteEnvIdx - 10, viteEnvIdx + 60) : 'NOT FOUND — already resolved at build time');

// Find the axios.create call
const createIdx = content.indexOf('baseURL:');
if (createIdx > -1) {
  console.log('[BUILD-AUDIT] baseURL: context:', content.substring(createIdx - 5, createIdx + 80));
}

console.log('\n[CONCLUSION] The production Vercel build is calling http://localhost:3001/api from the browser.');
console.log('[CONCLUSION] Since localhost does not exist from a browser context, all API calls FAIL before reaching Railway.');
console.log('[CONCLUSION] Vercel vercel.json route /api/(.*) is NEVER hit because api.js uses an absolute localhost URL, bypassing Vercel proxy routing.');
