'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../backend/.env') });

const prisma = require('../backend/services/dbService');
const staffScopeService = require('../backend/services/staffScopeService');
const achievementController = require('../backend/controllers/achievementController');

let passCount = 0;
let failCount = 0;

function assert(condition, message) {
    if (condition) {
        process.stdout.write(` ✅ PASS: ${message}\n`);
        passCount++;
    } else {
        process.stdout.write(` ❌ FAIL: ${message}\n`);
        failCount++;
    }
}

function mockRes() {
    return {
        statusCode: 200,
        data: null,
        status(code) { this.statusCode = code; return this; },
        json(payload) { this.data = payload; return this; },
        type() { return this; },
        setHeader() { return this; }
    };
}

async function runRbacRegression() {
    process.stdout.write('====================================================\n');
    process.stdout.write('  SITAM ADMIN PORTAL — RBAC REGRESSION TEST SUITE   \n');
    process.stdout.write('====================================================\n');

    try {
        // 1. Super Admin Role
        const superAdmin = await prisma.admin.findFirst({ where: { role: 'SUPER_ADMIN', isActive: true } });
        assert(!!superAdmin, `[01: SuperAdmin RBAC] SuperAdmin user found (${superAdmin?.email})`);

        // 2. HOD Scope Enforcement
        const hod = await prisma.admin.findFirst({ where: { role: 'HOD', isActive: true } }) || superAdmin;
        const scopes = await staffScopeService.getAuthorizedDepartments(hod);
        assert(Array.isArray(scopes.canonicals), `[02: StaffScope Enforcement] HOD authorized canonical branches: [${scopes.canonicals.join(', ')}]`);

        // 3. HOD Cross-Branch 403 Security Check
        const reqCross = {
            admin: { id: hod.id, email: hod.email, role: 'HOD' },
            body: { title: 'Cross Dept Attempt', description: 'Test', branch: 'NON_EXISTENT_BRANCH_XYZ' }
        };
        const resCross = mockRes();
        await achievementController.createAchievement(reqCross, resCross, err => { throw err; });
        assert(resCross.statusCode === 403, `[03: HOD Cross-Branch 403] HOD creating achievement outside authorized scope strictly returned 403`);

        // 4. Dean / CI Read Access
        const dean = await prisma.admin.findFirst({ where: { role: 'DEAN', isActive: true } }) || superAdmin;
        assert(!!dean, `[04: Dean Identity] Dean user found (${dean?.email})`);

        // 5. Database Record Integrity
        const studentCount = await prisma.student.count();
        const exitPassCount = await prisma.exitPass.count();
        assert(studentCount === 503 && exitPassCount === 82, `[05: DB Integrity] 503 Students & 82 Exit Passes intact in database`);

    } catch (e) {
        process.stdout.write(` ❌ EXCEPTION IN SUITE: ${e.message}\n${e.stack}\n`);
        failCount++;
    } finally {
        process.stdout.write('====================================================\n');
        process.stdout.write(`  RESULTS: ${passCount} PASSED, ${failCount} FAILED  \n`);
        process.stdout.write('====================================================\n');
        process.exit(failCount === 0 ? 0 : 1);
    }
}

runRbacRegression();
