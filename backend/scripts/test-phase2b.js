'use strict';
/**
 * SITAM Smart ERP — Phase 2B Automated Authorization & Scope Test Suite
 * Tests RBAC permissions, StaffScope department resolution, Hostel Warden read-only rules,
 * IDOR prevention, and regression protection across all staff roles.
 */

const assert = require('assert');
const { PERMISSIONS, ROLE_PERMISSIONS, hasPermission, requirePermission } = require('../middleware/permissions');
const staffScopeService = require('../services/staffScopeService');
const hostelService = require('../services/hostelService');

async function runTests() {
    console.log('====================================================');
    console.log('  SITAM SMART ERP — PHASE 2B AUTOMATED TEST SUITE   ');
    console.log('====================================================\n');

    let passed = 0;
    let failed = 0;

    function test(name, fn) {
        try {
            fn();
            console.log(`  ✓ ${name}`);
            passed++;
        } catch (err) {
            console.error(`  ✗ ${name}`);
            console.error(`    Error: ${err.message}`);
            failed++;
        }
    }

    async function asyncTest(name, fn) {
        try {
            await fn();
            console.log(`  ✓ ${name}`);
            passed++;
        } catch (err) {
            console.error(`  ✗ ${name}`);
            console.error(`    Error: ${err.message}`);
            failed++;
        }
    }

    // ─── 1. ROLE-PERMISSION MATRIX VERIFICATION ─────────────────────────────
    console.log('--- 1. RBAC PERMISSIONS & ROLE MATRIX ---');

    test('SUPER_ADMIN possesses all permissions', () => {
        for (const p of Object.values(PERMISSIONS)) {
            assert.strictEqual(hasPermission('SUPER_ADMIN', p), true, `SUPER_ADMIN missing ${p}`);
        }
    });

    test('HOD permissions matrix', () => {
        assert.strictEqual(hasPermission('HOD', PERMISSIONS.STUDENT_BASIC_READ), true);
        assert.strictEqual(hasPermission('HOD', PERMISSIONS.STUDENT_ACADEMIC_READ), true);
        assert.strictEqual(hasPermission('HOD', PERMISSIONS.STUDENT_FULL_READ), true);
        assert.strictEqual(hasPermission('HOD', PERMISSIONS.LIBRARY_UPLOAD), true);
        assert.strictEqual(hasPermission('HOD', PERMISSIONS.EXIT_PASS_APPROVE), true);
        assert.strictEqual(hasPermission('HOD', PERMISSIONS.ADMINISTRATION_READ), false);
    });

    test('DEAN permissions matrix', () => {
        assert.strictEqual(hasPermission('DEAN', PERMISSIONS.STUDENT_BASIC_READ), true);
        assert.strictEqual(hasPermission('DEAN', PERMISSIONS.STUDENT_ACADEMIC_READ), true);
        assert.strictEqual(hasPermission('DEAN', PERMISSIONS.ADMINISTRATION_READ), true);
        // Dean must NOT automatically inherit SUPER_ADMIN permissions (e.g. no infra/secret controls)
        assert.strictEqual(ROLE_PERMISSIONS.DEAN.length < ROLE_PERMISSIONS.SUPER_ADMIN.length, true);
    });

    test('CI permissions matrix', () => {
        assert.strictEqual(hasPermission('CI', PERMISSIONS.STUDENT_BASIC_READ), true);
        assert.strictEqual(hasPermission('CI', PERMISSIONS.STUDENT_ACADEMIC_READ), true);
        assert.strictEqual(hasPermission('CI', PERMISSIONS.ADMINISTRATION_READ), true);
        assert.strictEqual(hasPermission('CI', PERMISSIONS.LIBRARY_UPLOAD), false);
        assert.strictEqual(hasPermission('CI', PERMISSIONS.EXIT_PASS_APPROVE), false);
    });

    test('HOSTEL_WARDEN permissions matrix (Read-only)', () => {
        assert.strictEqual(hasPermission('HOSTEL_WARDEN', PERMISSIONS.STUDENT_BASIC_READ), true);
        assert.strictEqual(hasPermission('HOSTEL_WARDEN', PERMISSIONS.EXIT_PASS_READ), true);
        assert.strictEqual(hasPermission('HOSTEL_WARDEN', PERMISSIONS.STUDENT_ACADEMIC_READ), false);
        assert.strictEqual(hasPermission('HOSTEL_WARDEN', PERMISSIONS.STUDENT_FULL_READ), false);
        assert.strictEqual(hasPermission('HOSTEL_WARDEN', PERMISSIONS.EXIT_PASS_APPROVE), false);
        assert.strictEqual(hasPermission('HOSTEL_WARDEN', PERMISSIONS.EXIT_PASS_GATE_VERIFY), false);
    });

    // ─── 2. DEPARTMENT ALIAS & CANONICALIZATION ─────────────────────────────
    console.log('\n--- 2. DEPARTMENT ALIAS & CANONICALIZATION ---');

    test('Canonicalizes CSE and COMPUTER SCIENCE ENGINEERING to AIML', () => {
        assert.strictEqual(staffScopeService.canonicalizeBranch('CSE'), 'AIML');
        assert.strictEqual(staffScopeService.canonicalizeBranch('COMPUTER SCIENCE ENGINEERING'), 'AIML');
        assert.strictEqual(staffScopeService.canonicalizeBranch('AIML'), 'AIML');
    });

    test('Canonicalizes ARTIFICIAL INTELLIGENCE AND DATA SCIENCE to AIDS', () => {
        assert.strictEqual(staffScopeService.canonicalizeBranch('AIDS'), 'AIDS');
        assert.strictEqual(staffScopeService.canonicalizeBranch('ARTIFICIAL INTELLIGENCE AND DATA SCIENCE'), 'AIDS');
    });

    test('Canonicalizes ELECTRONICS & COMMUNICATION ENGINEERING to ECE', () => {
        assert.strictEqual(staffScopeService.canonicalizeBranch('ECE'), 'ECE');
        assert.strictEqual(staffScopeService.canonicalizeBranch('ELECTRONICS & COMMUNICATION ENGINEERING'), 'ECE');
    });

    test('Returns raw branch for unknown branch', () => {
        assert.strictEqual(staffScopeService.canonicalizeBranch('CUSTOM_DEPT'), 'CUSTOM_DEPT');
    });

    // ─── 3. STAFF SCOPE RESOLUTION & IDOR PROTECTION ────────────────────────
    console.log('\n--- 3. STAFF SCOPE & IDOR PROTECTION ---');

    await asyncTest('HOD AIML -> AIML student: 200 (ALLOWED)', async () => {
        const hodAiml = { id: 'admin-aiml-hod', role: 'HOD' };
        const studentAiml = { id: 's1', branch: 'AIML' };
        // Mock getAuthorizedDepartments for test
        const allowed = staffScopeService.canAccessBranchWithScopes(['AIML'], studentAiml.branch);
        assert.strictEqual(allowed, true);
    });

    await asyncTest('HOD AIML -> CSE student: 200 (ALLOWED via AIML scope expansion)', async () => {
        const studentCse = { id: 's2', branch: 'CSE' };
        const allowed = staffScopeService.canAccessBranchWithScopes(['AIML'], studentCse.branch);
        assert.strictEqual(allowed, true);
    });

    await asyncTest('HOD AIML -> ECE student: 403 (FORBIDDEN / IDOR PREVENTED)', async () => {
        const studentEce = { id: 's3', branch: 'ECE' };
        const allowed = staffScopeService.canAccessBranchWithScopes(['AIML'], studentEce.branch);
        assert.strictEqual(allowed, false);
    });

    await asyncTest('HOD ECE -> ECE student: 200 (ALLOWED)', async () => {
        const studentEce = { id: 's3', branch: 'ECE' };
        const allowed = staffScopeService.canAccessBranchWithScopes(['ECE'], studentEce.branch);
        assert.strictEqual(allowed, true);
    });

    await asyncTest('HOD ECE -> AIML student: 403 (FORBIDDEN)', async () => {
        const studentAiml = { id: 's1', branch: 'AIML' };
        const allowed = staffScopeService.canAccessBranchWithScopes(['ECE'], studentAiml.branch);
        assert.strictEqual(allowed, false);
    });

    await asyncTest('DEAN -> students from every canonical department: 200 (ALLOWED)', async () => {
        const dean = { id: 'admin-dean', role: 'DEAN' };
        const res = await staffScopeService.getAuthorizedDepartments(dean);
        assert.strictEqual(res.canonicals.length, 9);
        for (const dept of staffScopeService.ALL_CANONICAL_DEPARTMENTS) {
            assert.strictEqual(staffScopeService.canAccessBranchWithScopes(res.canonicals, dept), true);
        }
    });

    await asyncTest('CI -> institution-wide permitted student data: 200 (ALLOWED)', async () => {
        const ci = { id: 'admin-ci', role: 'CI' };
        const res = await staffScopeService.getAuthorizedDepartments(ci);
        assert.strictEqual(res.canonicals.length, 9);
    });

    // ─── 4. HOSTEL WARDEN READ-ONLY & SANITIZATION ───────────────────────────
    console.log('\n--- 4. HOSTEL WARDEN SANITIZATION & READ-ONLY ENFORCEMENT ---');

    test('HOSTEL_WARDEN -> hostel student basic profile: 200 (SANITISED)', () => {
        const rawStudent = {
            id: 's-hostel-1',
            name: 'John Doe',
            roll: '21SIT001',
            branch: 'AIML',
            year: '3',
            semester: '5',
            section: 'A',
            hostel: 'Boys Hostel 1',
            roomNo: '204',
            gender: 'Male',
            photoUrl: 'https://example.com/photo.jpg',
            // Sensitive fields
            phone: '9876543210',
            password: 'hashed_password_secret',
            fees: [{ amount: 50000, dueAmount: 10000 }],
            marks: [{ grade: 'A' }]
        };

        const sanitized = hostelService.sanitizeStudentForWarden(rawStudent);
        assert.strictEqual(sanitized.id, 's-hostel-1');
        assert.strictEqual(sanitized.name, 'John Doe');
        assert.strictEqual(sanitized.phone, undefined);
        assert.strictEqual(sanitized.password, undefined);
        assert.strictEqual(sanitized.fees, undefined);
        assert.strictEqual(sanitized.marks, undefined);
    });

    test('HOSTEL_WARDEN -> non-hostel student check: false', () => {
        const dayScholar = { id: 's-day-1', hostel: null };
        const dayScholarNo = { id: 's-day-2', hostel: 'No' };
        assert.strictEqual(hostelService.isHostelResident(dayScholar), false);
        assert.strictEqual(hostelService.isHostelResident(dayScholarNo), false);
    });

    test('HOSTEL_WARDEN -> approve exit pass: 403 (FORBIDDEN)', () => {
        assert.throws(() => {
            hostelService.assertWardenReadOnly('APPROVE');
        }, err => err.status === 403);
    });

    test('HOSTEL_WARDEN -> reject exit pass: 403 (FORBIDDEN)', () => {
        assert.throws(() => {
            hostelService.assertWardenReadOnly('REJECT');
        }, err => err.status === 403);
    });

    test('HOSTEL_WARDEN -> gate confirmation: 403 (FORBIDDEN)', () => {
        assert.throws(() => {
            hostelService.assertWardenReadOnly('GATE_VERIFY');
        }, err => err.status === 403);
    });

    // ─── 5. REGRESSION PROTECTION ───────────────────────────────────────────
    console.log('\n--- 5. REGRESSION PROTECTION ---');

    test('SUPER_ADMIN regression check: PASS', () => {
        assert.strictEqual(hasPermission('SUPER_ADMIN', PERMISSIONS.STUDENT_FULL_READ), true);
        assert.strictEqual(hasPermission('SUPER_ADMIN', PERMISSIONS.ADMINISTRATION_READ), true);
    });

    test('FACULTY regression check: PASS', () => {
        assert.strictEqual(hasPermission('FACULTY', PERMISSIONS.STUDENT_BASIC_READ), true);
        assert.strictEqual(hasPermission('FACULTY', PERMISSIONS.LIBRARY_UPLOAD), true);
        assert.strictEqual(hasPermission('FACULTY', PERMISSIONS.ADMINISTRATION_READ), false);
    });

    test('SECURITY_GUARD regression check: PASS', () => {
        assert.strictEqual(hasPermission('SECURITY_GUARD', PERMISSIONS.EXIT_PASS_GATE_VERIFY), true);
        assert.strictEqual(hasPermission('SECURITY_GUARD', PERMISSIONS.STUDENT_ACADEMIC_READ), false);
    });

    test('ACCOUNTS_ADMIN regression check: PASS', () => {
        assert.strictEqual(hasPermission('ACCOUNTS_ADMIN', PERMISSIONS.STUDENT_FULL_READ), true);
        assert.strictEqual(hasPermission('ACCOUNTS_ADMIN', PERMISSIONS.ADMINISTRATION_READ), true);
        assert.strictEqual(hasPermission('ACCOUNTS_ADMIN', PERMISSIONS.EXIT_PASS_GATE_VERIFY), false);
    });

    console.log('\n====================================================');
    console.log(`  RESULTS: ${passed} PASSED, ${failed} FAILED               `);
    console.log('====================================================\n');

    if (failed > 0) {
        process.exit(1);
    }
}

runTests().catch(err => {
    console.error('Test runner crash:', err);
    process.exit(1);
});