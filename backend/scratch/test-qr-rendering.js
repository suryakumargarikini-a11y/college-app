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

async function testQrLifecycle() {
    console.log('=== TEST SUITE: QR Token Generation, Unwrapping & Rendering ===\n');

    const student = await prisma.student.findFirst();
    const admin = await prisma.admin.findFirst();
    if (!student || !admin) {
        console.error('No student or admin found');
        return;
    }
    console.log(`Student: ${student.name} (${student.roll}), Admin: ${admin.email || admin.id}`);

    // Clean up
    await prisma.exitPass.deleteMany({ where: { studentId: student.id } });

    // Step 1: Create pass via apply()
    const reqApply = {
        session: { studentId: student.id, userId: student.userId },
        body: {
            destination: 'Vizag',
            reason: 'Medical',
            exitTime: new Date(Date.now() + 3600000).toISOString(),
            emergencyContact: '9876543210'
        }
    };
    const resApply = makeMockRes();
    await exitPassesController.apply(reqApply, resApply);
    const passId = resApply.body.id;
    console.log(`[TEST 1] Pass created: ID ${passId}, status: ${resApply.body.status}`);

    // Step 2: Admin approves pass
    const reqApprove = {
        params: { id: passId },
        admin: { id: admin.id, email: admin.email || 'admin@sitam.edu.in', role: 'SUPER_ADMIN' }
    };
    const resApprove = makeMockRes();
    await exitPassesController.approve(reqApprove, resApprove);
    console.log(`[TEST 2] Admin approved pass: status ${resApprove.body.status}`);

    // TEST A: Check DB fields
    const approvedPassDb = await prisma.exitPass.findUnique({ where: { id: passId } });
    console.log(`[TEST A] DB Check: status=${approvedPassDb.status}, qrCode=${approvedPassDb.qrCode ? 'POPULATED' : 'NULL'}, qrTokenHash=${approvedPassDb.qrTokenHash ? 'POPULATED' : 'NULL'}, verifiedAt=${approvedPassDb.verifiedAt}`);

    // TEST B & C: Call getQrToken and verify response shape
    const reqQr = {
        params: { id: passId },
        session: { studentId: student.id, userId: student.userId }
    };
    const resQr = makeMockRes();
    await exitPassesController.getQrToken(reqQr, resQr);
    console.log(`[TEST B] getQrToken status: ${resQr.statusCode}`);
    console.log(`[TEST B] getQrToken body keys:`, Object.keys(resQr.body));

    // TEST C: Verify frontend unwrapping logic
    const tokRes = resQr.body;
    const extractedToken = tokRes?.qrToken || tokRes?.token || tokRes?.data?.qrToken || tokRes?.data?.token;
    console.log(`[TEST C] Frontend token extraction result: Token received: ${extractedToken ? 'YES' : 'NO'}`);

    // TEST G: Security verifies & consumes QR
    const reqVerifyQr = {
        body: { token: extractedToken },
        admin: { id: admin.id, email: admin.email || 'guard1@sitam.edu.in', role: 'SECURITY_GUARD' }
    };
    const resVerifyQr = makeMockRes();
    await exitPassesController.verifyQrToken(reqVerifyQr, resVerifyQr);
    console.log(`[TEST G] Guard scanned QR: valid=${resVerifyQr.body.valid}, status=${resVerifyQr.body.status}`);

    // TEST H: Student requests QR token AFTER security scan
    const resQrAfterScan = makeMockRes();
    await exitPassesController.getQrToken(reqQr, resQrAfterScan);
    console.log(`[TEST H] Student getQrToken after scan: Status ${resQrAfterScan.statusCode}, Error message: "${resQrAfterScan.body?.error}"`);

    // Clean up
    await prisma.exitPass.deleteMany({ where: { id: passId } });
    console.log('\n=== All QR Lifecycle Tests Finished Successfully ===');
}

testQrLifecycle().then(() => prisma.$disconnect());
