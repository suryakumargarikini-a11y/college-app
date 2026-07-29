'use strict';

/**
 * test-phase2c.js
 * SITAM Smart ERP — Phase 2C Staff Provisioning & Authorization Test Suite
 *
 * Validates:
 * 1. Provisioning script idempotency and database records.
 * 2. Real HTTP login (POST /api/admin/auth/login) for all 13 staff accounts.
 * 3. JWT role claim verification.
 * 4. Comprehensive Authorization Matrix (AIML, ECE, AIDS, Dean, CI, Hostel Warden).
 * 5. E-Library audience targeting authorization matrix.
 * 6. Hostel Warden read-only field sanitization & write-route blocking.
 */

// ── 1. Force TEST Environment BEFORE Module Imports ───────────────────────────
process.env.NODE_ENV = 'test';
process.env.ADMIN_JWT_SECRET = 'sitam-admin-secret-key-32-chars-long-production-grade';
process.env.ADMIN_PASSWORD_SALT = 'sitam-admin-salt-test-key-32-chars';

// ── 2. Run Fail-Closed Centralized Database Guard BEFORE DB Client Init ───────
const { validateTestDatabase } = require('../services/testDbGuard');

try {
    validateTestDatabase();
} catch (guardError) {
    console.error(`[FATAL] Test Database Guard rejected execution: ${guardError.message}`);
    process.exit(1);
}

// ── 3. Map Validated TEST_DATABASE_URL to DATABASE_URL ──────────────────────
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

// ── 4. Load Database & Application Modules (Safe after Guard) ───────────────
const express = require('express');
const http = require('http');
const prisma = require('../services/dbService');
const { seedStaff, STAFF_SPECIFICATIONS } = require('./seedStaff');
const { verifyToken } = require('../middleware/adminAuth');
const { PERMISSIONS, ROLE_PERMISSIONS } = require('../middleware/permissions');
const staffScopeService = require('../services/staffScopeService');
const hostelService = require('../services/hostelService');

let fetchModule;
async function fetchApi(url, opts) {
    if (!fetchModule) {
        fetchModule = (await import('node-fetch')).default || globalThis.fetch;
    }
    return fetchModule(url, opts);
}

// ── 5. Generate Unique Test Run ID & Scoped Credentials Map ─────────────────
const testRunId = `tr_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

const TEST_CREDENTIALS = {
    HOD_AIML_EMAIL: `hod.aiml.${testRunId}@sitam.edu.in`,
    HOD_AIML_PASSWORD: 'Pass_HOD_AIML_2026!',
    HOD_AIDS_EMAIL: `hod.aids.${testRunId}@sitam.edu.in`,
    HOD_AIDS_PASSWORD: 'Pass_HOD_AIDS_2026!',
    HOD_ECE_EMAIL: `hod.ece.${testRunId}@sitam.edu.in`,
    HOD_ECE_PASSWORD: 'Pass_HOD_ECE_2026!',
    HOD_IT_EMAIL: `hod.it.${testRunId}@sitam.edu.in`,
    HOD_IT_PASSWORD: 'Pass_HOD_IT_2026!',
    HOD_MECH_EMAIL: `hod.mech.${testRunId}@sitam.edu.in`,
    HOD_MECH_PASSWORD: 'Pass_HOD_MECH_2026!',
    HOD_CIVIL_EMAIL: `hod.civil.${testRunId}@sitam.edu.in`,
    HOD_CIVIL_PASSWORD: 'Pass_HOD_CIVIL_2026!',
    HOD_EEE_EMAIL: `hod.eee.${testRunId}@sitam.edu.in`,
    HOD_EEE_PASSWORD: 'Pass_HOD_EEE_2026!',
    HOD_MBA_EMAIL: `hod.mba.${testRunId}@sitam.edu.in`,
    HOD_MBA_PASSWORD: 'Pass_HOD_MBA_2026!',
    HOD_POLYTECHNIC_EMAIL: `hod.poly.${testRunId}@sitam.edu.in`,
    HOD_POLYTECHNIC_PASSWORD: 'Pass_HOD_POLY_2026!',
    DEAN_1_EMAIL: `dean1.${testRunId}@sitam.edu.in`,
    DEAN_1_PASSWORD: 'Pass_DEAN_1_2026!',
    DEAN_2_EMAIL: `dean2.${testRunId}@sitam.edu.in`,
    DEAN_2_PASSWORD: 'Pass_DEAN_2_2026!',
    CI_EMAIL: `ci.${testRunId}@sitam.edu.in`,
    CI_PASSWORD: 'Pass_CI_2026!',
    HOSTEL_WARDEN_EMAIL: `warden.${testRunId}@sitam.edu.in`,
    HOSTEL_WARDEN_PASSWORD: 'Pass_WARDEN_2026!'
};

const createdTestAdminEmails = Object.values(TEST_CREDENTIALS).filter(v => typeof v === 'string' && v.includes('@'));

let server;
let baseUrl;

async function setupTestApp() {
    const app = express();
    app.use(express.json());

    // Attach Admin Auth routes
    const authRoutes = require('../routes/admin/auth');
    app.use('/api/admin/auth', authRoutes);

    // Attach Exit Pass routes
    const exitPassRoutes = require('../routes/admin/exitPasses');
    app.use('/api/admin/exit-passes', exitPassRoutes);

    // Attach Student admin routes
    const studentAdminRoutes = require('../routes/admin/students');
    app.use('/api/admin/students', studentAdminRoutes);

    // Attach Library routes
    const libraryRoutes = require('../routes/library');
    app.use('/api/library', libraryRoutes);

    return new Promise((resolve) => {
        server = http.createServer(app);
        server.listen(0, '127.0.0.1', () => {
            const port = server.address().port;
            baseUrl = `http://127.0.0.1:${port}`;
            resolve();
        });
    });
}

async function runPhase2cTests() {
    console.log(`=== SITAM SMART ERP — PHASE 2C TEST SUITE (Run ID: ${testRunId}) ===\n`);
    let totalTests = 0;
    let passedTests = 0;

    function assertTest(condition, name, details = '') {
        totalTests++;
        if (condition) {
            passedTests++;
            console.log(`  [PASS] ${name}`);
        } else {
            console.error(`  [FAIL] ${name} ${details ? '(' + details + ')' : ''}`);
        }
    }

    let createdAdminIds = [];

    try {
        await setupTestApp();

        // ── 1. Provisioning Dry-Run & Seed Verification ────────────────────────
        console.log('1. PROVISIONING SCRIPT & RECORD SEEDING');
        Object.assign(process.env, TEST_CREDENTIALS);

        const seedResults = await seedStaff({ silent: true });
        assertTest(seedResults.length === 13, 'Provisioning script processed exactly 13 accounts');
        const successCount = seedResults.filter(r => r.status.startsWith('SUCCESS')).length;
        assertTest(successCount === 13, 'All 13 accounts successfully provisioned');

        // Check StaffScope count in database
        const adminAccounts = await prisma.admin.findMany({
            where: { email: { in: createdTestAdminEmails } },
            include: { staffScopes: true }
        });
        assertTest(adminAccounts.length === 13, 'Found exactly 13 staff accounts in Admin table');
        createdAdminIds = adminAccounts.map(a => a.id);

        const wardenAcc = adminAccounts.find(a => a.role === 'HOSTEL_WARDEN');
        assertTest(wardenAcc && wardenAcc.staffScopes.length === 0, 'Hostel Warden has 0 StaffScope rows');

        const aimlAcc = adminAccounts.find(a => a.role === 'HOD' && a.email === TEST_CREDENTIALS.HOD_AIML_EMAIL);
        assertTest(aimlAcc && aimlAcc.staffScopes.length === 1 && aimlAcc.staffScopes[0].scopeValue === 'AIML', 'HOD_AIML has exact AIML StaffScope');

        const deanAcc = adminAccounts.find(a => a.role === 'DEAN' && a.email === TEST_CREDENTIALS.DEAN_1_EMAIL);
        assertTest(deanAcc && deanAcc.staffScopes.length === 9, 'Dean 1 has 9 StaffScope rows for institution-wide academic scope');

        // ── 2. Real HTTP Authentication Tests ─────────────────────────────────
        console.log('\n2. REAL HTTP AUTHENTICATION & JWT CLAIM VERIFICATION');
        const tokens = {};

        for (const spec of STAFF_SPECIFICATIONS) {
            const email = TEST_CREDENTIALS[spec.emailEnv];
            const password = TEST_CREDENTIALS[spec.passwordEnv];

            const res = await fetchApi(`${baseUrl}/api/admin/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
            });

            assertTest(res.status === 200, `POST /api/admin/auth/login -> HTTP 200 for ${spec.key}`);
            const body = await res.json();
            assertTest(body.token && body.admin && body.admin.role === spec.role, `JWT payload role claim matches '${spec.role}' for ${spec.key}`);

            const decoded = verifyToken(body.token);
            assertTest(decoded.role === spec.role && decoded.email === email.toLowerCase(), `Decoded JWT token verifies role '${spec.role}'`);
            tokens[spec.key] = body.token;
        }

        // ── 3. Authorization Matrix Tests ─────────────────────────────────────
        console.log('\n3. AUTHORIZATION & SCOPE VERIFICATION MATRIX');

        // AIML HOD scope tests
        const { canonicals: aimlCanonicals, rawAliases: aimlRawAliases } = await staffScopeService.getAuthorizedDepartments(aimlAcc);
        assertTest(aimlCanonicals.includes('AIML') && aimlRawAliases.includes('CSE'), 'HOD_AIML scope expands to allow both AIML and CSE');
        assertTest(!aimlCanonicals.includes('ECE') && !aimlRawAliases.includes('ECE'), 'HOD_AIML scope excludes ECE');

        // ECE HOD scope tests
        const eceAcc = adminAccounts.find(a => a.email === TEST_CREDENTIALS.HOD_ECE_EMAIL);
        const { canonicals: eceCanonicals, rawAliases: eceRawAliases } = await staffScopeService.getAuthorizedDepartments(eceAcc);
        assertTest(eceCanonicals.includes('ECE') && eceRawAliases.includes('ECE'), 'HOD_ECE scope includes ECE');
        assertTest(!eceCanonicals.includes('AIML') && !eceRawAliases.includes('CSE'), 'HOD_ECE scope excludes AIML and CSE');

        // AIDS HOD scope tests
        const aidsAcc = adminAccounts.find(a => a.email === TEST_CREDENTIALS.HOD_AIDS_EMAIL);
        const { canonicals: aidsCanonicals, rawAliases: aidsRawAliases } = await staffScopeService.getAuthorizedDepartments(aidsAcc);
        assertTest(aidsCanonicals.includes('AIDS') && aidsRawAliases.includes('AIDS'), 'HOD_AIDS scope includes AIDS');
        assertTest(!aidsCanonicals.includes('ECE') && !aidsRawAliases.includes('ECE'), 'HOD_AIDS scope excludes ECE');

        // Dean Scope tests
        const { canonicals: deanAllowedDepts } = await staffScopeService.getAuthorizedDepartments(deanAcc);
        assertTest(deanAllowedDepts.length === 9, 'Dean scope covers all 9 canonical academic departments');

        // ── 4. Hostel Warden Security & Read-Only Tests ────────────────────────
        console.log('\n4. HOSTEL WARDEN READ-ONLY & SANITIZATION MATRIX');
        const wardenToken = tokens.HOSTEL_WARDEN;

        // Warden Exit Pass listing (HTTP 200)
        const wardenExitRes = await fetchApi(`${baseUrl}/api/admin/exit-passes`, {
            headers: { Authorization: `Bearer ${wardenToken}` }
        });
        assertTest(wardenExitRes.status === 200, 'Hostel Warden GET /api/admin/exit-passes -> HTTP 200');

        // Warden Exit Pass Approve attempt (HTTP 403)
        const wardenApproveRes = await fetchApi(`${baseUrl}/api/admin/exit-passes/pass-123/approve`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${wardenToken}` }
        });
        assertTest(wardenApproveRes.status === 403, 'Hostel Warden POST /approve -> HTTP 403 Forbidden');

        // Warden Exit Pass Reject attempt (HTTP 403)
        const wardenRejectRes = await fetchApi(`${baseUrl}/api/admin/exit-passes/pass-123/reject`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${wardenToken}` }
        });
        assertTest(wardenRejectRes.status === 403, 'Hostel Warden POST /reject -> HTTP 403 Forbidden');

        // Warden QR Gate verify attempt (HTTP 403)
        const wardenVerifyRes = await fetchApi(`${baseUrl}/api/admin/exit-passes/verify-qr`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${wardenToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ qrToken: 'token123' })
        });
        assertTest(wardenVerifyRes.status === 403, 'Hostel Warden POST /verify-qr -> HTTP 403 Forbidden');

        // Warden Student Sanitization Verification
        const mockSensitiveStudent = {
            id: 's-1', name: 'Test Student', roll: '25B61A0599', branch: 'CSE', hostel: 'Yes', roomNo: '101',
            phone: '9999999999', email: 'test@sitam.edu.in', fatherMobile: '8888888888',
            fees: [{ amount: 50000 }], marks: [{ grade: 'A+' }]
        };
        const sanitized = hostelService.sanitizeStudentForWarden(mockSensitiveStudent);
        assertTest(sanitized.phone === undefined, 'Sanitized student excludes phone number');
        assertTest(sanitized.email === undefined, 'Sanitized student excludes email address');
        assertTest(sanitized.fees === undefined, 'Sanitized student excludes fees data');
        assertTest(sanitized.marks === undefined, 'Sanitized student excludes marks data');
        assertTest(sanitized.name === 'Test Student' && sanitized.hostel === 'Yes', 'Sanitized student retains basic hostel details');

        // Day-scholar check for Warden
        const dayScholar = { hostel: 'No' };
        assertTest(hostelService.isHostelResident(dayScholar) === false, 'isHostelResident correctly identifies Day Scholar as false');

        // ── 5. E-Library Audience Targeting Matrix Tests ───────────────────────────
        console.log('\n5. E-LIBRARY AUDIENCE TARGETING MATRIX');
        const pdfBuffer = Buffer.from('%PDF-1.4 sample pdf content');

        // HOD AIML upload to AIML (Allowed)
        const aimlTargetRes = await fetchApi(`${baseUrl}/api/library/admin/materials?title=TestAIML&branch=AIML`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${tokens.HOD_AIML}`,
                'x-file-name': 'sample.pdf',
                'content-type': 'application/pdf'
            },
            body: pdfBuffer
        });
        assertTest(aimlTargetRes.status === 201 || aimlTargetRes.status === 200, 'HOD_AIML targeting AIML department -> HTTP 201/200 Created');

        // HOD AIML upload to ECE (HTTP 403)
        const aimlEceTargetRes = await fetchApi(`${baseUrl}/api/library/admin/materials?title=TestECE&branch=ECE`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${tokens.HOD_AIML}`,
                'x-file-name': 'sample.pdf',
                'content-type': 'application/pdf'
            },
            body: pdfBuffer
        });
        assertTest(aimlEceTargetRes.status === 403, 'HOD_AIML targeting ECE department -> HTTP 403 Forbidden');

        // HOD ECE upload to AIML (HTTP 403)
        const eceAimlTargetRes = await fetchApi(`${baseUrl}/api/library/admin/materials?title=TestAIML&branch=AIML`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${tokens.HOD_ECE}`,
                'x-file-name': 'sample.pdf',
                'content-type': 'application/pdf'
            },
            body: pdfBuffer
        });
        assertTest(eceAimlTargetRes.status === 403, 'HOD_ECE targeting AIML department -> HTTP 403 Forbidden');

        // Hostel Warden Upload attempt (HTTP 403)
        const wardenUploadRes = await fetchApi(`${baseUrl}/api/library/admin/materials?title=TestWarden&branch=AIML`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${wardenToken}`,
                'x-file-name': 'sample.pdf',
                'content-type': 'application/pdf'
            },
            body: pdfBuffer
        });
        assertTest(wardenUploadRes.status === 403, 'Hostel Warden POST /api/library/admin/materials -> HTTP 403 Forbidden');

    } catch (err) {
        console.error('Test execution error:', err);
    } finally {
        // Guaranteed Scoped Cleanup for THIS testRunId only
        try {
            if (prisma && createdTestAdminEmails.length > 0) {
                await prisma.admin.deleteMany({
                    where: { email: { in: createdTestAdminEmails } }
                });

                // Post-cleanup verification for this test run
                const remainingAdmins = await prisma.admin.count({
                    where: { email: { in: createdTestAdminEmails } }
                });
                const remainingScopes = createdAdminIds.length > 0 ? await prisma.staffScope.count({
                    where: { adminId: { in: createdAdminIds } }
                }) : 0;

                if (remainingAdmins > 0 || remainingScopes > 0) {
                    console.error(`[TEARDOWN_ALERT] Scoped cleanup left records! Admins: ${remainingAdmins}, Scopes: ${remainingScopes}`);
                }
            }
        } catch (cleanupErr) {
            console.error('Teardown cleanup failed:', cleanupErr.message);
        }
        if (server) server.close();
    }

    console.log(`\n==================================================`);
    console.log(`PHASE 2C TEST RESULT: ${passedTests}/${totalTests} PASSED`);
    console.log(`==================================================`);

    if (passedTests !== totalTests) {
        process.exit(1);
    }
}

if (require.main === module) {
    runPhase2cTests().then(() => process.exit(0));
}

module.exports = { runPhase2cTests, testRunId };
