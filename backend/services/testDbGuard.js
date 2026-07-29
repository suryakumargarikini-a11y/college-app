'use strict';

/**
 * testDbGuard.js
 * SITAM Smart ERP — Centralized Destructive Test Database Safety Guard
 *
 * Fail-Closed Rules:
 * 1. NODE_ENV must equal "test".
 * 2. ALLOW_DESTRUCTIVE_TEST_DB must equal "true".
 * 3. TEST_DATABASE_URL must be defined (zero fallback to DATABASE_URL).
 * 4. Target host/database must pass explicit positive test DB identification.
 * 5. Target host/database must not match any known production/shared targets.
 * 6. Throws Error on validation failure — never calls process.exit() directly.
 */

const BLOCKED_HOST_PATTERNS = Object.freeze([
    'railway.internal',
    'railway.app',
    'postgres.railway.internal',
    'dpg-d92biglckfvc73dgp7og-a.oregon-postgres.render.com',
    'render.com',
    'amazonaws.com',
    'azure.com',
    'google.com'
]);

const BLOCKED_DB_NAMES = Object.freeze([
    'college_app_q7aa',
    'production',
    'prod',
    'sitam_prod',
    'sitam_production',
    'railway'
]);

function sanitizeUrl(rawUrl) {
    if (!rawUrl || typeof rawUrl !== 'string') {
        return { host: 'NONE', dbName: 'NONE' };
    }
    try {
        const parsed = new URL(rawUrl);
        return {
            host: parsed.hostname || 'UNKNOWN',
            dbName: (parsed.pathname || '').replace(/^\//, '') || 'UNKNOWN'
        };
    } catch (_) {
        return { host: 'INVALID_URL', dbName: 'INVALID_URL' };
    }
}

function validateTestDatabase(options = {}) {
    const isQuiet = options.quiet || false;

    // 1. Requirement: NODE_ENV === 'test'
    if (process.env.NODE_ENV !== 'test') {
        const msg = `[DB_GUARD_BLOCKED] Validation failed: NODE_ENV is '${process.env.NODE_ENV}', required 'test'.`;
        if (!isQuiet) console.error(msg);
        throw new Error(msg);
    }

    // 2. Requirement: ALLOW_DESTRUCTIVE_TEST_DB === 'true'
    if (process.env.ALLOW_DESTRUCTIVE_TEST_DB !== 'true') {
        const msg = `[DB_GUARD_BLOCKED] Validation failed: ALLOW_DESTRUCTIVE_TEST_DB is '${process.env.ALLOW_DESTRUCTIVE_TEST_DB}', required 'true'.`;
        if (!isQuiet) console.error(msg);
        throw new Error(msg);
    }

    // 3. Requirement: TEST_DATABASE_URL exists (Zero Fallback)
    const testUrl = process.env.TEST_DATABASE_URL;
    if (!testUrl || typeof testUrl !== 'string' || testUrl.trim() === '') {
        const msg = `[DB_GUARD_BLOCKED] Validation failed: TEST_DATABASE_URL is missing or empty. Fallback to DATABASE_URL is strictly prohibited.`;
        if (!isQuiet) console.error(msg);
        throw new Error(msg);
    }

    // 4. Parse & Sanitize Target URL
    const { host, dbName } = sanitizeUrl(testUrl);

    if (host === 'INVALID_URL' || host === 'NONE' || dbName === 'INVALID_URL' || dbName === 'NONE') {
        const msg = `[DB_GUARD_BLOCKED] Validation failed: TEST_DATABASE_URL could not be parsed as a valid connection URL.`;
        if (!isQuiet) console.error(msg);
        throw new Error(msg);
    }

    // 5. Explicit Blacklist Check (Forbidden Hosts / DBs)
    const hostLower = host.toLowerCase();
    for (const pattern of BLOCKED_HOST_PATTERNS) {
        if (hostLower.includes(pattern)) {
            const msg = `[DB_GUARD_BLOCKED] Validation failed: TEST_DATABASE_URL host '${host}' matches forbidden target '${pattern}'.`;
            if (!isQuiet) console.error(msg);
            throw new Error(msg);
        }
    }

    const dbLower = dbName.toLowerCase();
    for (const blockedDb of BLOCKED_DB_NAMES) {
        if (dbLower === blockedDb) {
            const msg = `[DB_GUARD_BLOCKED] Validation failed: Database name '${dbName}' matches forbidden database '${blockedDb}'.`;
            if (!isQuiet) console.error(msg);
            throw new Error(msg);
        }
    }

    // 6. Positive Identification Check (Fail Closed!)
    // Database target must be positively identified as a dedicated test instance.
    const isLocalhost = hostLower === 'localhost' || hostLower === '127.0.0.1' || hostLower === '::1';
    const isExplicitTestHost = hostLower.includes('test') || hostLower.includes('mock');
    const isExplicitTestDb = dbLower.includes('test') || dbLower.includes('mock');

    const passesPositiveIdentification = (isLocalhost || isExplicitTestHost) && isExplicitTestDb;

    if (!passesPositiveIdentification) {
        const msg = `[DB_GUARD_BLOCKED] Validation failed: Target host '${host}' / database '${dbName}' failed positive test DB identification. Target database name must explicitly contain 'test' (e.g. sitam_test_db) and run on a local/test host. Identity is uncertain -> failing closed.`;
        if (!isQuiet) console.error(msg);
        throw new Error(msg);
    }

    if (!isQuiet) {
        console.log(`[DB_GUARD_PASSED] Test Database Positive Identification Verified.`);
        console.log(`  Target Host: ${host}`);
        console.log(`  Target Database: ${dbName}`);
    }

    return { host, dbName, isAllowed: true };
}

module.exports = {
    validateTestDatabase,
    sanitizeUrl,
    BLOCKED_HOST_PATTERNS,
    BLOCKED_DB_NAMES
};
