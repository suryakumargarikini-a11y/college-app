'use strict';
const prisma = require('../services/dbService');
const exitPassesController = require('../controllers/admin/exitPassesController');

const makeMockRes = () => {
    return {
        statusCode: 200,
        body: null,
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(data) {
            this.body = data;
            return this;
        }
    };
};

async function testAll() {
    console.log('=== TEST SUITE: Exit Pass Submission (Individual & Group) ===\n');

    const student = await prisma.student.findFirst();
    if (!student) {
        console.error('No student found in DB.');
        return;
    }
    console.log(`Using Student: ${student.name} (${student.roll}), ID: ${student.id}`);

    // Clean up existing passes for this student
    await prisma.exitPass.deleteMany({ where: { studentId: student.id } });
    console.log('Cleared existing exit passes for student.\n');

    // TEST A: Individual WITHOUT returnTime
    console.log('--- TEST A: Individual Pass WITHOUT returnTime ---');
    {
        const req = {
            session: { studentId: student.id, userId: student.userId },
            body: {
                destination: 'Visakhapatnam',
                reason: 'Medical Appointment',
                exitTime: new Date(Date.now() + 86400000).toISOString(),
                emergencyContact: '9876543210',
                remarks: 'Doctor appointment'
            }
        };
        const res = makeMockRes();
        await exitPassesController.apply(req, res);
        console.log('Response Status:', res.statusCode);
        console.log('Response Body:', res.body);
        if (res.statusCode === 201 && res.body.success) {
            console.log('✅ TEST A PASSED: Pass created with status =', res.body.status, 'and returnTime =', res.body.returnTime);
        } else {
            console.error('❌ TEST A FAILED!');
        }
    }

    // Clean up
    await prisma.exitPass.deleteMany({ where: { studentId: student.id } });

    // TEST B: Individual WITH returnTime (Backward Compatibility)
    console.log('\n--- TEST B: Individual Pass WITH returnTime ---');
    {
        const req = {
            session: { studentId: student.id, userId: student.userId },
            body: {
                destination: 'Anakapalle',
                reason: 'Family Work',
                exitTime: new Date(Date.now() + 86400000).toISOString(),
                returnTime: new Date(Date.now() + 172800000).toISOString(),
                emergencyContact: '9876543210'
            }
        };
        const res = makeMockRes();
        await exitPassesController.apply(req, res);
        console.log('Response Status:', res.statusCode);
        console.log('Response Body:', res.body);
        if (res.statusCode === 201 && res.body.success) {
            console.log('✅ TEST B PASSED: Pass created with returnTime =', res.body.returnTime);
        } else {
            console.error('❌ TEST B FAILED!');
        }
    }

    // Clean up
    await prisma.exitPass.deleteMany({ where: { studentId: student.id } });

    // TEST C: Group Pass WITHOUT returnTime
    console.log('\n--- TEST C: Group Pass WITHOUT returnTime ---');
    {
        const req = {
            session: { studentId: student.id, userId: student.userId },
            body: {
                groupName: 'Tech Fest Team',
                destination: 'Vizag Convention Center',
                reason: 'Hackathon Participation',
                exitTime: new Date(Date.now() + 86400000).toISOString(),
                members: [student.roll]
            }
        };
        const res = makeMockRes();
        await exitPassesController.applyGroup(req, res);
        console.log('Response Status:', res.statusCode);
        console.log('Response Body:', res.body);
        if (res.statusCode === 201 && res.body.success) {
            console.log('✅ TEST C PASSED: Group pass created!');
        } else {
            console.error('❌ TEST C FAILED!');
        }
    }

    // Clean up
    await prisma.exitPass.deleteMany({ where: { studentId: student.id } });
    await prisma.groupExitPassRequest.deleteMany({ where: { leaderId: student.id } });

    // TEST D: GET /api/exit-passes/my (student history fetch)
    console.log('\n--- TEST D: GET /api/exit-passes/my ---');
    {
        // First create a pass
        const reqApply = {
            session: { studentId: student.id, userId: student.userId },
            body: {
                destination: 'Library',
                reason: 'Project work',
                exitTime: new Date(Date.now() + 86400000).toISOString(),
                emergencyContact: '9876543210'
            }
        };
        await exitPassesController.apply(reqApply, makeMockRes());

        const reqMy = {
            session: { studentId: student.id, userId: student.userId }
        };
        const resMy = makeMockRes();
        await exitPassesController.getMyPasses(reqMy, resMy);
        console.log('Response Status:', resMy.statusCode);
        console.log('Returned passes count:', Array.isArray(resMy.body) ? resMy.body.length : 'N/A');
        if (Array.isArray(resMy.body) && resMy.body.length > 0) {
            console.log('✅ TEST D PASSED: Fetched pass ID:', resMy.body[0].id, 'Status:', resMy.body[0].status, 'returnTime:', resMy.body[0].returnTime);
        } else {
            console.error('❌ TEST D FAILED!');
        }
    }

    // Clean up
    await prisma.exitPass.deleteMany({ where: { studentId: student.id } });

    console.log('\n=== All Controller Tests Finished ===');
}

testAll().then(() => prisma.$disconnect());
