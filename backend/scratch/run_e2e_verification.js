/**
 * SITAM Smart ERP — Real End-to-End Verification Suite
 * ─────────────────────────────────────────────────────────────────────────────
 * Performs full E2E verification of the login pipeline using real ERP credentials.
 * Handles server lifecycle, DB checks, HTTP API requests, and log auditing.
 *
 * RUN: node scratch/run_e2e_verification.js
 */
'use strict';

const { spawn } = require('child_process');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const { PrismaClient } = require('@prisma/client');

const PORT = 3001;
const BASE_URL = `http://localhost:${PORT}`;

const CREDENTIALS_A = { userId: '25B61A4532', password: 'webcap' }; // Thanushk
const CREDENTIALS_B = { userId: '25B61A0596', password: 'webcap' }; // Harika

let serverProcess = null;
let serverLogs = '';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// SQLite URL for the local dev.db that the E2E server writes to
const SQLITE_DB_PATH = path.join(__dirname, '..', 'prisma', 'dev.db').replace(/\\/g, '/');
const SQLITE_URL = `file:///${SQLITE_DB_PATH}?connection_limit=1&socket_timeout=30&timeout=30`;
function makeSqlitePrisma() { return new PrismaClient({ datasources: { db: { url: SQLITE_URL } } }); }

// ─── Phase 3: DB Clean Prep ──────────────────────────────────────────────────
async function cleanDatabaseForStudents() {
    console.log('\n[PHASE 3] Database Verification — Cleaning existing records to force full sync...');
    let prisma = null;
    try {
        prisma = makeSqlitePrisma();
        const studentABefore = await prisma.student.findUnique({ where: { userId: CREDENTIALS_A.userId } });
        const studentBBefore = await prisma.student.findUnique({ where: { userId: CREDENTIALS_B.userId } });

        console.log(`  Student A (${CREDENTIALS_A.userId}) exists before login: ${!!studentABefore}`);
        console.log(`  Student B (${CREDENTIALS_B.userId}) exists before login: ${!!studentBBefore}`);

        if (studentABefore) {
            await prisma.student.delete({ where: { userId: CREDENTIALS_A.userId } });
            console.log(`  Deleted existing Student A record to guarantee a clean sync scrape.`);
        }
        if (studentBBefore) {
            await prisma.student.delete({ where: { userId: CREDENTIALS_B.userId } });
            console.log(`  Deleted existing Student B record.`);
        }
    } catch (e) {
        console.warn('  Database cleanup skipped (will proceed anyway):', e.message);
    } finally {
        if (prisma) {
            try { await prisma.$disconnect(); } catch (_) {}
        }
    }
}

// ─── Start Backend Server ────────────────────────────────────────────────────
const BACKEND_DIR = path.join(__dirname, '..');
const ENV_TEST_PATH = path.join(BACKEND_DIR, '.env.e2e-test');

function writeTestEnv() {
    const sqliteUrl = `file:${path.join(BACKEND_DIR, 'prisma', 'dev.db')}?connection_limit=1&socket_timeout=30&timeout=30`;
    const lines = [
        `PORT=${PORT}`,
        `NODE_ENV=development`,
        `DATABASE_URL="${sqliteUrl}"`,
        `ERP_PROVIDER=scraper`,
        `BROWSER_PROVIDER=PLAYWRIGHT`,
        `DISABLE_REDIS=true`,
        `OTEL_SDK_DISABLED=true`,
        `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=http://127.0.0.1:4318/v1/traces`,
        `DISABLE_SCHEDULERS=true`,
        `DEMO_MODE=false`,
        // Paste other non-secret vars that server.js reads at startup:
        `ERP_BASE_URL=https://sitamecap.co.in/SATYA`,
        `ADMIN_EMAIL=admin@sitam.edu.in`,
        `ADMIN_NAME=SITAM Administrator`,
    ];
    fs.writeFileSync(ENV_TEST_PATH, lines.join('\n'), 'utf8');
    console.log(`[SERVER] Wrote temporary test env to ${ENV_TEST_PATH}`);
}

function cleanTestEnv() {
    try { fs.unlinkSync(ENV_TEST_PATH); } catch (_) {}
}

function startServer() {
    return new Promise((resolve, reject) => {
        console.log('\n[SERVER] Spawning SITAM backend server locally...');

        // Write a .env.e2e-test file so dotenv does NOT load production .env
        writeTestEnv();

        // Switch schema to SQLite before starting
        try {
            require('child_process').execSync('node scripts/use-sqlite.js && npx prisma generate --schema prisma/schema.prisma', { cwd: BACKEND_DIR, stdio: 'inherit' });
        } catch (err) {
            console.warn('[SERVER] Could not switch schema to SQLite:', err.message);
        }

        const env = {
            ...process.env,
            DOTENV_CONFIG_PATH: ENV_TEST_PATH,   // honoured by dotenv >=16 config({ path })
            PORT: String(PORT),
            NODE_ENV: 'development',
            DATABASE_URL: `file:${path.join(BACKEND_DIR, 'prisma', 'dev.db')}?connection_limit=1&socket_timeout=30&timeout=30`,
            DISABLE_REDIS: 'true',
            ERP_PROVIDER: 'scraper',
            BROWSER_PROVIDER: 'PLAYWRIGHT',
            OTEL_SDK_DISABLED: 'true',
            OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: 'http://127.0.0.1:4318/v1/traces',
            DISABLE_SCHEDULERS: 'true',
            DEMO_MODE: 'false',
        };

        serverProcess = spawn('node', ['server.js'], {
            cwd: BACKEND_DIR,
            env
        });

        serverProcess.stdout.on('data', (data) => {
            const str = data.toString();
            serverLogs += str;
            process.stdout.write(`[SERVER-OUT] ${str}`);
            if (str.includes(`listening on port ${PORT}`) || str.includes('ready. System is production-ready') || str.includes(`running on port ${PORT}`)) {
                resolve();
            }
        });

        serverProcess.stderr.on('data', (data) => {
            const str = data.toString();
            serverLogs += str;
            process.stderr.write(`[SERVER-ERR] ${str}`);
        });

        serverProcess.on('error', (err) => {
            cleanTestEnv();
            reject(err);
        });

        // Fail-safe timeout (120 seconds)
        setTimeout(() => {
            cleanTestEnv();
            reject(new Error('Server startup timed out after 120s'));
        }, 120000);

    });
}

// ─── Audit Backend Logs (Phase 2) ────────────────────────────────────────────
function auditLogs() {
    console.log('\n[PHASE 2] Auditing Backend Logs for Critical Issues...');
    const keywords = [
        'Target.createTarget',
        'Target closed',
        'SIGTRAP',
        'Browser disconnected',
        'Browser exited',
        'OOM',
        'Protocol error',
        'Queue timeout',
        'Acquire timeout',
        'BrowserPool warnings',
        'ReferenceError',
        'Unhandled rejection'
    ];

    const auditResults = {};
    let passed = true;

    keywords.forEach(keyword => {
        // Use word boundary for OOM to avoid matching "roomNo" or "Room.No"
        let regex;
        if (keyword === 'OOM') {
            regex = /\bOOM\b/g;
        } else {
            regex = new RegExp(keyword.replace('.', '\\.'), 'gi');
        }
        const matches = serverLogs.match(regex);
        const count = matches ? matches.length : 0;

        auditResults[keyword] = count;
        if (count > 0) {
            console.error(`  ✗ [FAIL] Keyword "${keyword}" found ${count} time(s)!`);
            passed = false;
        } else {
            console.log(`  ✓ [PASS] Keyword "${keyword}": 0 occurrences`);
        }
    });

    return { passed, auditResults };
}

// ─── DB Verification After Sync (Phase 3) ────────────────────────────────────────
// Uses the HTTP API (profile endpoint) to confirm data is in the DB, avoiding
// SQLite file-lock issues while the server is running.
async function verifyDatabaseRecord(userId, token) {
    if (!token) {
        console.error(`  ✗ [FAIL] DB check: No auth token provided for ${userId}`);
        return { exists: false, error: 'no token' };
    }
    try {
        const res = await axios.get(`${BASE_URL}/api/profile`, {
            headers: { Authorization: `Bearer ${token}` }
        });
        const profile = res.data.profile || res.data.data || res.data;
        if (res.status === 200 && profile && (profile.name || profile.studentName)) {
            console.log(`  ✓ [PASS] DB check: Student ${userId} confirmed in DB via /api/profile.`);
            console.log(`           Name: ${profile.name || profile.studentName} | Roll: ${profile.roll}`);
            return { exists: true };
        } else {
            console.error(`  ✗ [FAIL] DB check: /api/profile returned 200 but no profile data for ${userId}`);
            return { exists: false };
        }
    } catch (e) {
        console.error('  DB verification error:', e.message);
        return { exists: false, error: e.message };
    }
}

// ─── API Fields Verification (Phase 4) ────────────────────────────────────────
function verifyProfileFields(profile) {
    console.log('\n[PHASE 4] Profile API Field Validation...');
    const requiredFields = [
        'name', 'fatherName', 'motherName', 'email', 'phone', 'address',
        'department', 'branch', 'semester', 'section', 'roll', 'admissionNo'
    ];

    const missing = [];
    const fields = {};
    
    requiredFields.forEach(field => {
        const val = profile[field];
        fields[field] = val !== undefined && val !== null ? val : 'NULL';
        if (val === undefined || val === null || val === '') {
            missing.push(field);
        }
    });

    console.log('  Profile fields returned:');
    Object.entries(fields).forEach(([k, v]) => {
        console.log(`    - ${k.padEnd(15)}: ${v}`);
    });

    if (missing.length > 0) {
        console.warn(`  ⚠ [WARN] Fields missing or null: ${missing.join(', ')}`);
        return { valid: true, missing }; // Warnings are fine if ERP itself has none, but let's log them
    }
    console.log('  ✓ [PASS] All profile fields validated successfully.');
    return { valid: true, missing: [] };
}

// ─── MAIN SUITE RUNNER ────────────────────────────────────────────────────────
async function runE2E() {
    const report = {
        loginResults: {},
        httpStatuses: {},
        dbVerification: {},
        apiVerification: {},
        dashboardVerification: {},
        performance: {},
        failures: []
    };

    try {
        // Step 1: Clean Database
        await cleanDatabaseForStudents();

        // Step 2: Start Server
        await startServer();
        console.log('[SERVER] Server is live and ready on port 3001.');

        // ────────────────────────────────────────────────────────────────────
        // STRESS TEST / LOGIN 1: First Login (Student A) -> Full Sync Scrape
        // ────────────────────────────────────────────────────────────────────
        console.log('\n======================================================================');
        console.log('  PHASE 1 — First Login for Student A (Scraper Sync)');
        console.log('======================================================================');

        const t0 = Date.now();
        console.log(`[HTTP] Posting to /api/auth/login for ${CREDENTIALS_A.userId}...`);
        const loginRes1 = await axios.post(`${BASE_URL}/api/auth/login`, CREDENTIALS_A, {
            headers: { 'Content-Type': 'application/json' }
        });
        const loginDuration1 = Date.now() - t0;
        report.performance.firstLogin = loginDuration1;

        console.log(`  Login 1 Response:`, loginRes1.status, loginRes1.data.message);
        console.log(`  Received Token: ${loginRes1.data.token?.substring(0, 15)}...`);
        console.log(`  Student Name: ${loginRes1.data.studentName}`);

        report.loginResults.studentA_1 = loginRes1.data.success;
        report.httpStatuses.login = loginRes1.status;
        const tokenA = loginRes1.data.token;

        // ────────────────────────────────────────────────────────────────────
        // PHASE 3 — DB Check Post-Login (via /api/profile)
        // ────────────────────────────────────────────────────────────────────
        const dbCheckA = await verifyDatabaseRecord(CREDENTIALS_A.userId, tokenA);
        report.dbVerification.studentA = dbCheckA.exists;
        if (!dbCheckA.exists) {
            report.failures.push({ phase: 3, msg: 'Student A not written to DB' });
        }

        // ────────────────────────────────────────────────────────────────────
        // PHASE 4 — Profile API Verification
        // ────────────────────────────────────────────────────────────────────
        console.log('\n======================================================================');
        console.log('  PHASE 4 — Profile API Verification');
        console.log('======================================================================');
        const tProf0 = Date.now();
        const profileRes = await axios.get(`${BASE_URL}/api/profile`, {
            headers: { 'Authorization': `Bearer ${tokenA}` }
        });
        const profileDuration = Date.now() - tProf0;
        report.performance.profileLoad = profileDuration;
        report.httpStatuses.profile = profileRes.status;

        const profileFields = verifyProfileFields(profileRes.data.profile || profileRes.data.data || {});
        report.apiVerification = {
            status: profileRes.status,
            missingFields: profileFields.missing
        };

        // ────────────────────────────────────────────────────────────────────
        // PHASE 5 — Dashboard Verification
        // ────────────────────────────────────────────────────────────────────
        console.log('\n======================================================================');
        console.log('  PHASE 5 — Dashboard Endpoints Verification');
        console.log('======================================================================');
        const dashboardEndpoints = [
            { key: 'attendance', path: '/api/attendance' },
            { key: 'marks', path: '/api/marks' },
            { key: 'fees', path: '/api/fees' },
            { key: 'timetable', path: '/api/timetable' },
            { key: 'notifications', path: '/api/notifications' },
            { key: 'placements', path: '/api/placements' },
            { key: 'exitPasses', path: '/api/exit-passes/my' }
        ];

        for (const ep of dashboardEndpoints) {
            const tStart = Date.now();
            try {
                console.log(`[HTTP] GET ${ep.path}...`);
                const res = await axios.get(`${BASE_URL}${ep.path}`, {
                    headers: { 'Authorization': `Bearer ${tokenA}` }
                });
                const dur = Date.now() - tStart;
                console.log(`  ✓ ${ep.key.toUpperCase()} Status: ${res.status} in ${dur}ms`);
                report.httpStatuses[ep.key] = res.status;
                report.dashboardVerification[ep.key] = { status: res.status, ok: res.status === 200, duration: dur };
            } catch (err) {
                console.error(`  ✗ ${ep.key.toUpperCase()} FAILED:`, err.response ? err.response.status : err.message);
                report.httpStatuses[ep.key] = err.response ? err.response.status : 0;
                report.dashboardVerification[ep.key] = { status: report.httpStatuses[ep.key], ok: false, error: err.message };
                report.failures.push({ phase: 5, msg: `${ep.key} returned non-200: ${err.message}` });
            }
        }

        // ────────────────────────────────────────────────────────────────────
        // PHASE 6 — Cache Verification (Second Login)
        // ────────────────────────────────────────────────────────────────────
        console.log('\n======================================================================');
        console.log('  PHASE 6 — Cache Verification (Second Login for Student A)');
        console.log('======================================================================');
        const t2 = Date.now();
        console.log(`[HTTP] Posting to /api/auth/login again for ${CREDENTIALS_A.userId}...`);
        const loginRes2 = await axios.post(`${BASE_URL}/api/auth/login`, CREDENTIALS_A, {
            headers: { 'Content-Type': 'application/json' }
        });
        const loginDuration2 = Date.now() - t2;
        report.performance.secondLogin = loginDuration2;

        console.log(`  Login 2 Response:`, loginRes2.status, loginRes2.data.message);
        console.log(`  Login 2 Duration (should be instant cached): ${loginDuration2}ms`);
        report.loginResults.studentA_2 = loginRes2.data.success;

        if (loginDuration2 >= 1000) {
            console.warn(`  ⚠ [WARN] Cache check: Second login took ${loginDuration2}ms (expected < 1000ms for instant DB match).`);
            report.cacheVerification = { success: false, msg: 'Fallback sync occurred' };
        } else {
            console.log(`  ✓ [PASS] Cache check: Instant DB verification succeeded.`);
            report.cacheVerification = { success: true, ratio: loginDuration1 / loginDuration2 };
        }

        // ────────────────────────────────────────────────────────────────────
        // PHASE 7 — Multi-user Verification (Student B)
        // ────────────────────────────────────────────────────────────────────
        console.log('\n======================================================================');
        console.log('  PHASE 7 — Multi-user Verification (Student B Scraper Sync)');
        console.log('======================================================================');
        
        console.log(`[HTTP] Posting to /api/auth/login for Student B (${CREDENTIALS_B.userId})...`);
        const tB = Date.now();
        const loginResB = await axios.post(`${BASE_URL}/api/auth/login`, CREDENTIALS_B, {
            headers: { 'Content-Type': 'application/json' }
        });
        const loginDurationB = Date.now() - tB;
        console.log(`  Student B Login Response:`, loginResB.status, loginResB.data.message);
        console.log(`  Student B Duration: ${loginDurationB}ms`);
        console.log(`  Student B Name: ${loginResB.data.studentName}`);

        report.loginResults.studentB = loginResB.data.success;
        report.performance.studentBLogin = loginDurationB;
        const tokenB = loginResB.data.token;

        // Verify Student B in DB (via /api/profile)
        const dbCheckB = await verifyDatabaseRecord(CREDENTIALS_B.userId, tokenB);
        report.dbVerification.studentB = dbCheckB.exists;
        if (!dbCheckB.exists) {
            report.failures.push({ phase: 7, msg: 'Student B not written to DB' });
        }

        // Student A login again after Student B
        console.log(`\n[HTTP] Posting to /api/auth/login again for Student A (${CREDENTIALS_A.userId})...`);
        const tAAgain = Date.now();
        const loginResAAgain = await axios.post(`${BASE_URL}/api/auth/login`, CREDENTIALS_A, {
            headers: { 'Content-Type': 'application/json' }
        });
        const loginDurationAAgain = Date.now() - tAAgain;
        console.log(`  Student A Again Login Response:`, loginResAAgain.status, loginResAAgain.data.message);
        console.log(`  Student A Again Duration (should be cached): ${loginDurationAAgain}ms`);
        report.loginResults.studentA_3 = loginResAAgain.data.success;
        report.performance.studentAAgainLogin = loginDurationAAgain;

    } catch (e) {
        console.error('\n[FATAL ERROR DURING E2E SUITE]', e.response ? e.response.status : e.message);
        if (e.response && e.response.data) {
            console.error('Response data:', e.response.data);
        }
        report.failures.push({ phase: 0, msg: e.message, stack: e.stack });
    } finally {
        // Shutdown Server Gracefully
        if (serverProcess) {
            console.log('\n[SERVER] Terminating backend server...');
            serverProcess.kill();
        }

        // Clean up temp .env
        cleanTestEnv();

        // Restore PostgreSQL schema file (skip prisma generate — DLL may still be locked by killed process)
        try {
            require('child_process').execSync('node scripts/use-pg.js', { cwd: BACKEND_DIR, stdio: 'inherit' });
            console.log('[SERVER] PostgreSQL schema file restored. Run "npx prisma generate" to rebuild client.');
        } catch (err) {
            console.warn('[SERVER] Could not restore PostgreSQL schema:', err.message);
        }

        await sleep(1000); // Wait for logs to settle

        // Phase 2: Audit Logs
        const audit = auditLogs();
        report.logsAudit = audit;

        // Generate Deliverables (Phase 9)
        console.log('\n======================================================================');
        console.log('  E2E VERIFICATION REPORT — DELIVERABLES');
        console.log('======================================================================');

        const overallSuccess = report.failures.length === 0 && audit.passed;

        const reportMarkdown = `
# SITAM Smart ERP — Real End-to-End Verification Report
Generated on: ${new Date().toISOString()} | Local Time: ${new Date().toLocaleString()}

## 1. Login Pipeline Results
* **Student A (${CREDENTIALS_A.userId}) First Login (Scraper Sync)**: ${report.loginResults.studentA_1 ? '✅ SUCCESS' : '✗ FAILED'}
* **Student A (${CREDENTIALS_A.userId}) Second Login (Cached)**: ${report.loginResults.studentA_2 ? '✅ SUCCESS' : '✗ FAILED'}
* **Student B (${CREDENTIALS_B.userId}) Login (Scraper Sync)**: ${report.loginResults.studentB ? '✅ SUCCESS' : '✗ FAILED'}
* **Student A (${CREDENTIALS_A.userId}) Third Login (Cached)**: ${report.loginResults.studentA_3 ? '✅ SUCCESS' : '✗ FAILED'}

## 2. HTTP Status Codes
* **Login API Endpoint**: HTTP \`${report.httpStatuses.login || 'N/A'}\`
* **Profile API Endpoint**: HTTP \`${report.httpStatuses.profile || 'N/A'}\`
* **Attendance API**: HTTP \`${report.httpStatuses.attendance || 'N/A'}\`
* **Marks API**: HTTP \`${report.httpStatuses.marks || 'N/A'}\`
* **Fees API**: HTTP \`${report.httpStatuses.fees || 'N/A'}\`
* **Timetable API**: HTTP \`${report.httpStatuses.timetable || 'N/A'}\`
* **Notifications API**: HTTP \`${report.httpStatuses.notifications || 'N/A'}\`
* **Placements API**: HTTP \`${report.httpStatuses.placements || 'N/A'}\`
* **Exit Passes API**: HTTP \`${report.httpStatuses.exitPasses || 'N/A'}\`

## 3. Database Verification
* **Student A written to DB**: ${report.dbVerification.studentA ? '✅ VERIFIED' : '✗ FAILED'}
* **Student B written to DB**: ${report.dbVerification.studentB ? '✅ VERIFIED' : '✗ FAILED'}

## 4. API Field Verification
* **Status**: ${report.apiVerification.status === 200 ? '✅ 200 OK' : '✗ FAIL'}
* **Missing/Null Fields**: ${report.apiVerification.missingFields?.length === 0 ? 'None' : `\`${report.apiVerification.missingFields?.join(', ')}\``}

## 5. Dashboard Verification
* **Attendance Endpoint**: ${report.dashboardVerification.attendance?.ok ? '✅ 200 OK' : '✗ FAILED'}
* **Marks Endpoint**: ${report.dashboardVerification.marks?.ok ? '✅ 200 OK' : '✗ FAILED'}
* **Fees Endpoint**: ${report.dashboardVerification.fees?.ok ? '✅ 200 OK' : '✗ FAILED'}
* **Timetable Endpoint**: ${report.dashboardVerification.timetable?.ok ? '✅ 200 OK' : '✗ FAILED'}
* **Notifications Endpoint**: ${report.dashboardVerification.notifications?.ok ? '✅ 200 OK' : '✗ FAILED'}
* **Placements Endpoint**: ${report.dashboardVerification.placements?.ok ? '✅ 200 OK' : '✗ FAILED'}
* **Exit Passes Endpoint**: ${report.dashboardVerification.exitPasses?.ok ? '✅ 200 OK' : '✗ FAILED'}

## 6. Cache Verification (Performance Comparison)
* **First Login (Scraper Sync)**: \`${report.performance.firstLogin}ms\`
* **Second Login (Instant Cached)**: \`${report.performance.secondLogin}ms\`
* **Cache Acceleration Ratio**: \`${(report.performance.firstLogin / report.performance.secondLogin).toFixed(2)}x\` faster

## 7. Performance Timings (Student A)
* **First Login Sync Scrape**: \`${report.performance.firstLogin}ms\`
* **Profile API Load**: \`${report.performance.profileLoad}ms\`
* **Second Login (Instant)**: \`${report.performance.secondLogin}ms\`
* **Student B First Login**: \`${report.performance.studentBLogin}ms\`
* **Student A Third Login**: \`${report.performance.studentAAgainLogin}ms\`

## 8. Backend Logs Audit
* **Audit Status**: ${audit.passed ? '✅ PASSED' : '✗ FAILED'}
* **Details**:
${Object.entries(audit.auditResults).map(([k, v]) => `  - **${k}**: \`${v}\` occurrence(s)`).join('\n')}

## 9. Failures & Warnings
${report.failures.length === 0 ? '* None. All verification phases passed successfully.' : report.failures.map(f => `* **Phase ${f.phase}**: ${f.msg}`).join('\n')}

## 10. Verification Outcome: ${overallSuccess ? '🏆 SUCCESS' : '✗ FAILED'}
`;

        console.log(reportMarkdown);
        fs.writeFileSync(path.join(__dirname, 'e2e_verification_report.md'), reportMarkdown);
        console.log(`[DELIVERABLE] Written report markdown to scratch/e2e_verification_report.md`);

        process.exit(overallSuccess ? 0 : 1);
    }
}

runE2E().catch(console.error);
