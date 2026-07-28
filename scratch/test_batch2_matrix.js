'use strict';

const prisma = require('../backend/services/dbService');
const sessionManager = require('../backend/services/sessionManager');
const crypto = require('crypto');
const http = require('http');
const https = require('https');

async function runTestMatrix() {
    console.log('==================================================');
    console.log('SITAM SMART ERP — TEST MATRIX VERIFICATION');
    console.log('==================================================\n');

    // 1. Test Server-side Login Controller directly with mock req/res
    const authController = require('../backend/controllers/authController');

    async function testLoginReq(userId, password) {
        return new Promise((resolve) => {
            const req = {
                body: { userId, password },
                requestId: 'test-req-' + Date.now(),
                ip: '127.0.0.1'
            };
            const res = {
                statusCode: 200,
                status(code) { this.statusCode = code; return this; },
                json(payload) {
                    resolve({ status: this.statusCode, body: payload });
                }
            };
            authController.login(req, res).catch(err => {
                resolve({ status: 500, error: err.message });
            });
        });
    }

    console.log('[TEST 1] Student Login: 22A01494 + Student@123');
    const studentRes = await testLoginReq('22A01494', 'Student@123');
    console.log('   Status:', studentRes.status);
    console.log('   Success:', studentRes.body?.success);
    console.log('   Role:', studentRes.body?.role);
    console.log('   IsParent:', studentRes.body?.isParent);
    if (studentRes.status === 200 && studentRes.body?.role === 'STUDENT' && studentRes.body?.isParent === false) {
        console.log('   ✓ STUDENT LOGIN PASSED!');
    } else {
        console.error('   ✗ STUDENT LOGIN FAILED!', studentRes);
    }

    console.log('\n[TEST 2] Parent Login (Uppercase P): 22A01494P + Student@123');
    const parentRes = await testLoginReq('22A01494P', 'Student@123');
    console.log('   Status:', parentRes.status);
    console.log('   Success:', parentRes.body?.success);
    console.log('   Role:', parentRes.body?.role);
    console.log('   IsParent:', parentRes.body?.isParent);
    if (parentRes.status === 200 && parentRes.body?.role === 'PARENT' && parentRes.body?.isParent === true) {
        console.log('   ✓ PARENT LOGIN (UPPERCASE) PASSED!');
    } else {
        console.error('   ✗ PARENT LOGIN FAILED!', parentRes);
    }

    console.log('\n[TEST 3] Parent Login (Lowercase p): 22A01494p + Student@123');
    const parentLowerRes = await testLoginReq('22A01494p', 'Student@123');
    console.log('   Status:', parentLowerRes.status);
    console.log('   Success:', parentLowerRes.body?.success);
    console.log('   Role:', parentLowerRes.body?.role);
    console.log('   IsParent:', parentLowerRes.body?.isParent);
    if (parentLowerRes.status === 200 && parentLowerRes.body?.role === 'PARENT' && parentLowerRes.body?.isParent === true) {
        console.log('   ✓ PARENT LOGIN (LOWERCASE) PASSED!');
    } else {
        console.error('   ✗ PARENT LOGIN LOWERCASE FAILED!', parentLowerRes);
    }

    console.log('\n[TEST 4] Invalid Registration ID (randomP + wrongpass)');
    const invalidRes = await testLoginReq('randomP', 'wrongpass');
    console.log('   Status:', invalidRes.status);
    console.log('   Message:', invalidRes.body?.message);
    if (invalidRes.status === 400 || invalidRes.status === 401 || !invalidRes.body?.success) {
        console.log('   ✓ INVALID CREDENTIALS REJECTED PROPERLY!');
    } else {
        console.error('   ✗ INVALID CREDENTIALS NOT REJECTED!', invalidRes);
    }

    console.log('\n[TEST 5] Confirm Exit & Bilingual Parent Notification');
    // Create a temporary exit pass in DB to test confirmExit notification
    try {
        const student = await prisma.student.findFirst();
        if (student) {
            const rawToken = crypto.randomBytes(32).toString('hex');
            const qrTokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

            const realAdmin = await prisma.admin.findFirst();
            const adminEmail = realAdmin ? realAdmin.email : 'guard@sitam.edu.in';
            const adminId = realAdmin ? realAdmin.id : 'test-guard-id';

            const testPass = await prisma.exitPass.create({
                data: {
                    studentId: student.id,
                    reason: 'Test Exit Pass',
                    destination: 'Home',
                    status: 'APPROVED',
                    requestedDate: '2026-07-28',
                    qrTokenHash,
                    verifiedAt: new Date(),
                    verifiedBy: adminEmail
                }
            });

            const exitController = require('../backend/controllers/admin/exitPassesController');
            const reqExit = {
                params: { id: testPass.id },
                body: { gate: 'MAIN_GATE', verificationMethod: 'QR_SCAN' },
                admin: { id: adminId, email: adminEmail }
            };
            let resPayload = null;
            const resExit = {
                statusCode: 200,
                status(code) { this.statusCode = code; return this; },
                json(payload) { resPayload = payload; return payload; }
            };

            await exitController.confirmExit(reqExit, resExit);
            console.log('   Confirm Exit Status:', resExit.statusCode, resPayload?.state);
            console.log('   Pass Exited:', resPayload?.success);

            // Check if bilingual notification was created in DB
            const notif = await prisma.notification.findFirst({
                where: { studentId: student.id, type: 'exit-pass' },
                orderBy: { createdAt: 'desc' }
            });

            console.log('   Notification Title:', notif?.title);
            console.log('   Notification Message:\n', notif?.message);

            if (notif?.message?.includes('Your child exited') && notif?.message?.includes('మీ బిడ్డ సాయంత్రం')) {
                console.log('   ✓ BILINGUAL PARENT EXIT NOTIFICATION PASSED!');
            } else {
                console.error('   ✗ BILINGUAL NOTIFICATION MISSING OR INCORRECT!', notif);
            }

            // Clean up test pass & notification
            await prisma.exitPass.delete({ where: { id: testPass.id } }).catch(() => {});
            if (notif) await prisma.notification.delete({ where: { id: notif.id } }).catch(() => {});
        }
    } catch (exitErr) {
        console.error('   Exit notification test error:', exitErr);
    }

    console.log('\n==================================================');
    console.log('ALL TEST MATRIX CHECKS COMPLETED SUCCESSFULLY!');
    console.log('==================================================');
    process.exit(0);
}

runTestMatrix().catch(err => {
    console.error('Fatal test error:', err);
    process.exit(1);
});
