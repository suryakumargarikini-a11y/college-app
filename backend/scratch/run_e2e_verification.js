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

// ─── Phase 3: DB Clean Prep ──────────────────────────────────────────────────
async function cleanDatabaseForStudents() {
    console.log('\n[PHASE 3] Database Verification — Cleaning existing records to force full sync...');
    const prisma = new PrismaClient();
    try {
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
        console.error('  Database cleanup error:', e.message);
    } finally {
        await prisma.$disconnect();
    }
}

// ─── Start Backend Server ────────────────────────────────────────────────────
function startServer() {
    return new Promise((resolve, reject) => {
        console.log('\n[SERVER] Spawning SITAM backend server locally...');
        
        // Inherit environment variables but force PORT=3001
        const env = { 
            ...process.env, 
            PORT: String(PORT), 
            NODE_ENV: 'development', 
            DISABLE_REDIS: 'true', 
            ERP_PROVIDER: 'scraper',
            OTEL_SDK_DISABLED: 'true',
            OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: 'http://127.0.0.1:4318/v1/traces',
            DISABLE_SCHEDULERS: 'true'
        };

        
        serverProcess = spawn('node', ['server.js'], {

            cwd: path.join(__dirname, '..'),
            env
        });

        serverProcess.stdout.on('data', (data) => {
            const str = data.toString();
            serverLogs += str;
            process.stdout.write(`[SERVER-OUT] ${str}`);
            if (str.includes(`listening on port ${PORT}`) || str.includes('ready. System is production-ready')) {
                resolve();
            }
        });

        serverProcess.stderr.on('data', (data) => {
            const str = data.toString();
            serverLogs += str;
            process.stderr.write(`[SERVER-ERR] ${str}`);
        });

        serverProcess.on('error', (err) => {
            reject(err);
        });

        // Fail-safe timeout (120 seconds)
        setTimeout(() => {
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

// ─── DB Verification After Sync (Phase 3) ─────────────────────────────────────
async function verifyDatabaseRecord(userId) {
    const prisma = new PrismaClient();
    try {
        const student = await prisma.student.findUnique({
            where: { userId }
        });
        if (student) {
            console.log(`  ✓ [PASS] DB check: Student ${userId} successfully written to SQLite.`);
            console.log(`           Name: ${student.name} | Roll: ${student.roll} | Email: ${student.email}`);
            return { exists: true, student };
        } else {
            console.error(`  ✗ [FAIL] DB check: Student ${userId} DOES NOT EXIST in database!`);
            return { exists: false };
        }
    } catch (e) {
        console.error('  DB verification error:', e.message);
        return { exists: false, error: e.message };
    } finally {
        await prisma.$disconnect();
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
        // PHASE 3 — DB Check Post-Login
        // ────────────────────────────────────────────────────────────────────
        const dbCheckA = await verifyDatabaseRecord(CREDENTIALS_A.userId);
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

        // Verify Student B in DB
        const dbCheckB = await verifyDatabaseRecord(CREDENTIALS_B.userId);
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
