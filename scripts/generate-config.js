/**
 * SITAM Smart ERP — Dynamic Config Compiler
 *
 * Reads `API_BASE_URL` and `APP_VERSION` from environment variables
 * and generates `frontend/config.js` dynamically before server startups or builds.
 */

const fs = require('fs');
const path = require('path');

const apiBaseUrl = process.env.API_BASE_URL || 'http://localhost:8080/api';
const appVersion = process.env.APP_VERSION || '1.0.0';

const configContent = `// SITAM Smart ERP — Environment-Driven Configuration
// AUTO-GENERATED — DO NOT EDIT DIRECTLY OR COMMIT TO GIT

window.API_BASE_URL = "${apiBaseUrl}";
window.APP_VERSION = "${appVersion}";
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
    console.log(`  - API_BASE_URL = "${apiBaseUrl}"`);
    console.log(`  - APP_VERSION  = "${appVersion}"`);
} catch (err) {
    console.error(`[Config-Compiler] Error writing config: ${err.message}`);
    process.exit(1);
}
