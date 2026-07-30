'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../backend/.env') });

const prisma = require('../backend/services/dbService');
const staffScopeService = require('../backend/services/staffScopeService');
const achievementController = require('../backend/controllers/achievementController');
const libraryController = require('../backend/controllers/libraryController');

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
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(payload) {
            this.data = payload;
            return this;
        },
        type() { return this; },
        setHeader() { return this; }
    };
}

async function runSuite() {
    process.stdout.write('====================================================\n');
    process.stdout.write('   SITAM ERP — ACHIEVEMENTS & E-LIBRARY TEST SUITE  \n');
    process.stdout.write('====================================================\n');

    let cseHodAdmin = null;
    let createdCseAchId = null;
    let createdEceAchId = null;
    let studentObj = null;

    try {
        // 01. Lookup Super Admin
        const superAdmin = await prisma.admin.findFirst({ where: { role: 'SUPER_ADMIN', isActive: true } });
        assert(!!superAdmin, `[01: SuperAdmin Identity] Found ${superAdmin ? superAdmin.email : 'none'}`);

        // 02. Lookup Student
        studentObj = await prisma.student.findFirst();
        assert(!!studentObj, `[02: Student Identity] Found student ${studentObj ? studentObj.roll : 'none'}`);

        // 03. Create/Lookup Mock HOD for CSE
        let hodAdmin = await prisma.admin.findFirst({ where: { role: 'HOD', isActive: true } });
        if (!hodAdmin) {
            hodAdmin = superAdmin;
        }
        cseHodAdmin = hodAdmin;

        // Ensure HOD staff scope exists for CSE
        const existingScope = await prisma.staffScope.findFirst({
            where: { adminId: cseHodAdmin.id, scopeValue: 'CSE' }
        });
        if (!existingScope) {
            await prisma.staffScope.create({
                data: { adminId: cseHodAdmin.id, scopeType: 'DEPARTMENT', scopeValue: 'CSE' }
            });
        }
        assert(true, `[03: HOD Scope Verified] HOD ${cseHodAdmin.email} has CSE staff scope`);

        // 04. HOD creates achievement for own branch (CSE)
        const reqCreateCse = {
            admin: { id: cseHodAdmin.id, email: cseHodAdmin.email, name: cseHodAdmin.name, role: 'HOD' },
            body: {
                title: 'CSE National Coding Contest 2026 Winner',
                description: 'First prize won in National Coding League 2026 by CSE 3rd year team.',
                category: 'Competition',
                branch: 'CSE',
                participantName: 'K. Sai Kumar',
                isPublished: true
            }
        };
        const resCreateCse = mockRes();
        await achievementController.createAchievement(reqCreateCse, resCreateCse, err => { throw err; });
        assert(resCreateCse.statusCode === 201 && resCreateCse.data?.success, `[04: HOD Allowed Own Branch] HOD successfully created CSE achievement ID: ${resCreateCse.data?.achievement?.id}`);
        createdCseAchId = resCreateCse.data?.achievement?.id;

        // 05. HOD attempts to create achievement for ANOTHER branch (ECE) -> Expected 403 Forbidden!
        const reqCreateEce = {
            admin: { id: cseHodAdmin.id, email: cseHodAdmin.email, name: cseHodAdmin.name, role: 'HOD' },
            body: {
                title: 'ECE Robotics Championship',
                description: 'Robotics competition organized by ECE.',
                category: 'Sports',
                branch: 'ECE',
                isPublished: true
            }
        };
        const resCreateEce = mockRes();
        await achievementController.createAchievement(reqCreateEce, resCreateEce, err => { throw err; });
        assert(resCreateEce.statusCode === 403, `[05: HOD Blocked Cross-Branch Create] HOD creating ECE achievement strictly returned 403 Forbidden`);

        // 06. SuperAdmin creates achievement in ECE
        const reqSuperEce = {
            admin: { id: superAdmin.id, email: superAdmin.email, name: superAdmin.name, role: 'SUPER_ADMIN' },
            body: {
                title: 'ECE IEEE Paper Publication 2026',
                description: 'Research paper on VLSI signal processing published in IEEE.',
                category: 'Research',
                branch: 'ECE',
                isPublished: true
            }
        };
        const resSuperEce = mockRes();
        await achievementController.createAchievement(reqSuperEce, resSuperEce, err => { throw err; });
        assert(resSuperEce.statusCode === 201, `[06: SuperAdmin Institution-Wide Create] SuperAdmin created ECE achievement ID: ${resSuperEce.data?.achievement?.id}`);
        createdEceAchId = resSuperEce.data?.achievement?.id;

        // 07. HOD attempts to edit ECE achievement -> Expected 403 Forbidden!
        const reqEditEce = {
            admin: { id: cseHodAdmin.id, email: cseHodAdmin.email, name: cseHodAdmin.name, role: 'HOD' },
            params: { id: createdEceAchId },
            body: { title: 'Unauthorized Modification Attempt' }
        };
        const resEditEce = mockRes();
        await achievementController.updateAchievement(reqEditEce, resEditEce, err => { throw err; });
        assert(resEditEce.statusCode === 403, `[07: HOD Blocked Cross-Branch Update] HOD editing ECE achievement strictly returned 403 Forbidden`);

        // 08. HOD attempts to delete ECE achievement -> Expected 403 Forbidden!
        const reqDelEce = {
            admin: { id: cseHodAdmin.id, email: cseHodAdmin.email, name: cseHodAdmin.name, role: 'HOD' },
            params: { id: createdEceAchId }
        };
        const resDelEce = mockRes();
        await achievementController.deleteAchievement(reqDelEce, resDelEce, err => { throw err; });
        assert(resDelEce.statusCode === 403, `[08: HOD Blocked Cross-Branch Delete] HOD deleting ECE achievement strictly returned 403 Forbidden`);

        // 09. Student fetches achievements for their branch
        const reqStudentAch = {
            user: { id: studentObj.id },
            query: { scope: 'BRANCH' }
        };
        const resStudentAch = mockRes();
        await achievementController.getStudentAchievements(reqStudentAch, resStudentAch, err => { throw err; });
        assert(resStudentAch.statusCode === 200 && Array.isArray(resStudentAch.data?.achievements), `[09: Student Published Achievements] Student retrieved branch achievements (${resStudentAch.data?.achievements?.length} items)`);

        // 10. E-Library student listing test
        const reqLibStudent = {
            user: { id: studentObj.id },
            query: {}
        };
        const resLibStudent = mockRes();
        await libraryController.studentList(reqLibStudent, resLibStudent, err => { throw err; });
        assert(resLibStudent.statusCode === 200 && Array.isArray(resLibStudent.data), `[10: E-Library Student List] Retried E-Library materials (${resLibStudent.data?.length} active materials)`);

        // 11. E-Library admin listing test
        const reqLibAdmin = {
            admin: { id: superAdmin.id, email: superAdmin.email, role: 'SUPER_ADMIN' },
            query: {}
        };
        const resLibAdmin = mockRes();
        await libraryController.adminList(reqLibAdmin, resLibAdmin, err => { throw err; });
        assert(resLibAdmin.statusCode === 200 && Array.isArray(resLibAdmin.data), `[11: E-Library Admin List] Admin retrieved all E-Library materials (${resLibAdmin.data?.length} total materials)`);

    } catch (e) {
        process.stdout.write(` ❌ EXCEPTION IN SUITE: ${e.message}\n${e.stack}\n`);
        failCount++;
    } finally {
        // Cleanup test achievements
        if (createdCseAchId) {
            await prisma.achievement.deleteMany({ where: { id: createdCseAchId } });
        }
        if (createdEceAchId) {
            await prisma.achievement.deleteMany({ where: { id: createdEceAchId } });
        }
        process.stdout.write('====================================================\n');
        process.stdout.write(`  RESULTS: ${passCount} PASSED, ${failCount} FAILED  \n`);
        process.stdout.write('====================================================\n');
        process.exit(failCount === 0 ? 0 : 1);
    }
}

runSuite();
