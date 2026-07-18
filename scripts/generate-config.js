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

// PRODUCTION ONLY — all traffic routes through the active backend.
// Set API_BASE_URL in the environment to override.
const PRODUCTION_API_URL = 'https://web-production-259f33.up.railway.app/api';
const apiBaseUrl = process.env.API_BASE_URL || PRODUCTION_API_URL;

const appVersion = process.env.APP_VERSION || '1.0.0';

console.log(`[Config] Environment: ${envName}`);
console.log(`[Config] API Base URL: ${apiBaseUrl}`);

const configContent = `// SITAM Smart ERP — Environment-Driven Configuration
// AUTO-GENERATED — DO NOT EDIT DIRECTLY OR COMMIT TO GIT

window.API_BASE_URL = "${apiBaseUrl}";
window.APP_VERSION = "${appVersion}";
window.APP_CONFIG = {
  API_BASE_URL: "${apiBaseUrl}"
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
