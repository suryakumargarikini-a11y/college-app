const { execSync } = require('child_process');

function testGuard(name, envVars) {
    const envString = Object.entries(envVars).map(([k, v]) => `process.env['${k}'] = '${v}';`).join(' ');
    const code = `
        process.env.ADMIN_JWT_SECRET = '${envVars.ADMIN_JWT_SECRET !== undefined ? envVars.ADMIN_JWT_SECRET : ''}';
        process.env.ADMIN_PASSWORD_SALT = '${envVars.ADMIN_PASSWORD_SALT !== undefined ? envVars.ADMIN_PASSWORD_SALT : ''}';
        try {
            require('./backend/middleware/adminAuth.js');
            require('./backend/controllers/admin/authController.js');
            console.log('RESULT: STARTED_OK');
        } catch (e) {
            console.log('RESULT: THREW -> ' + e.message);
        }
    `;
    try {
        const out = execSync(`node -e "${code.replace(/\n/g, ' ')}"`, { cwd: 'd:/111', encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
        console.log(`[${name}] ${out.trim()}`);
    } catch (e) {
        console.log(`[${name}] Execution error: ${e.message}`);
    }
}

console.log('--- ISOLATED PROCESS STARTUP GUARD VALIDATION ---');
testGuard('Missing JWT Secret', {});
testGuard('Default JWT Secret', { ADMIN_JWT_SECRET: 'sitam-admin-secret-key-change-in-production', ADMIN_PASSWORD_SALT: 'valid-salt' });
testGuard('Short JWT Secret (<32)', { ADMIN_JWT_SECRET: 'short-secret-key-12345', ADMIN_PASSWORD_SALT: 'valid-salt' });
testGuard('Missing Pepper', { ADMIN_JWT_SECRET: 'a_very_long_and_secure_jwt_secret_32_chars_plus' });
testGuard('Default Pepper', { ADMIN_JWT_SECRET: 'a_very_long_and_secure_jwt_secret_32_chars_plus', ADMIN_PASSWORD_SALT: 'sitam-admin-salt' });
testGuard('Valid Secrets', { ADMIN_JWT_SECRET: 'a_very_long_and_secure_jwt_secret_32_chars_plus', ADMIN_PASSWORD_SALT: 'a_very_secure_admin_password_salt_pepper_123' });
