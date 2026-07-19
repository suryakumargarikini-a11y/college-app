/**
 * SITAM Smart ERP — Dynamic Config Compiler
 *
 * Reads `API_BASE_URL` and `APP_VERSION` from environment variables
 * and generates `frontend/config.js` dynamically before server startups or builds.
 */

const fs = require('fs');
const path = require('path');

const isProduction = process.env.RENDER || process.env.RAILWAY_ENVIRONMENT || process.env.NODE_ENV === 'production';
const envName = isProduction ? 'production' : 'development';

// IMPORTANT: API_BASE_URL must be set in the environment (Railway/Vercel dashboard).
// We do NOT hardcode a fallback domain here because:
//   1. The Railway domain has changed before (web-production-XXXXX can rotate).
//   2. Hardcoding creates silent misconfigurations when the domain changes.
// If API_BASE_URL is missing in production, fail loudly so the deploy is caught early.
const apiBaseUrl = process.env.API_BASE_URL;

if (!apiBaseUrl) {
    if (isProduction) {
        console.error('[Config] ERROR: API_BASE_URL environment variable is required in production. Set it in the Railway/Vercel dashboard.');
        process.exit(1);
    }
    // In development, allow a localhost fallback
    console.warn('[Config] WARNING: API_BASE_URL not set. Using http://localhost:8080/api for development.');
}

const resolvedApiUrl = apiBaseUrl || 'http://localhost:8080/api';


const appVersion = process.env.APP_VERSION || '1.0.0';

console.log(`[Config] Environment: ${envName}`);
console.log(`[Config] API Base URL: ${apiBaseUrl}`);

const configContent = `// SITAM Smart ERP — Environment-Driven Configuration
// AUTO-GENERATED — DO NOT EDIT DIRECTLY OR COMMIT TO GIT

window.API_BASE_URL = "${resolvedApiUrl}";
window.APP_VERSION = "${appVersion}";
window.APP_CONFIG = {
  API_BASE_URL: "${resolvedApiUrl}"
};
console.log("[SITAM Config] Dynamic API base loaded: " + window.API_BASE_URL + " (v" + window.APP_VERSION + ")");
`;


const targetPath = path.join(__dirname, '..', 'frontend', 'config.js');

try {
    // Ensure target folder exists
    const targetDir = path.dirname(targetPath);
    if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
    }

    fs.writeFileSync(targetPath, configContent, 'utf8');
    console.log(`[Config-Compiler] Generated ${targetPath} successfully.`);
} catch (err) {
    console.error(`[Config-Compiler] Error writing config: ${err.message}`);
    process.exit(1);
}
