'use strict';
process.env.DATABASE_URL = 'file:./dev.db';

const assert = require('assert');
const prisma = require('../services/dbService');
const exitPassesController = require('../controllers/admin/exitPassesController');
const notificationsController = require('../controllers/admin/notificationsController');
const dataControllers = require('../controllers/dataControllers');

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
        },
        send(data) {
            this.body = data;
            return this;
        },
        ok(data, message) {
            this.statusCode = 200;
            this.body = data;
            return this;
        },
        fail(message, data, code = 400) {
            this.statusCode = code;
            this.body = { error: message, data };
            return this;
        }
    };
};

async function runTests() {
    console.log('=== Starting Notifications & Exit Passes Integration Tests ===');

    // 1. Fetch seeded students
    console.log('[Setup] Fetching seeded students...');
    const students = await prisma.student.findMany({ take: 2 });
    if (students.length < 2) {
        throw new Error('Not enough seeded students in database. Please run npm run seed:demo first.');
    }
    const studentA = students[0];
    const studentB = students[1];
    console.log(`[Setup] Using Student A: ${studentA.name} (${studentA.roll}), Student B: ${studentB.name} (${studentB.roll})`);

    // Clean up any old test passes/notifications
    await prisma.exitPass.deleteMany({ where: { studentId: { in: [studentA.id, studentB.id] } } });
    await prisma.notification.deleteMany({ where: { studentId: { in: [studentA.id, studentB.id] } } });
    await prisma.notificationRead.deleteMany({ where: { studentId: { in: [studentA.id, studentB.id] } } });
    await prisma.adminNotification.deleteMany({ where: { title: { startsWith: 'TEST_' } } });

    console.log('[Setup] Mock database initialized.');

    // --- TEST CASE 1: Student Identity Security Gap in apply ---
    console.log('\n[Test 1] Verifying student identity security gap prevention in apply...');
    {
        // Try submitting for Student B while logged in as Student A
        const req = {
            session: { studentId: studentA.id, userId: studentA.userId },
            body: {
                studentId: studentB.id, // Fallback injection attempt
                destination: 'Home',
                reason: 'Weekend visit',
                exitTime: new Date(Date.now() + 3600000).toISOString(),
                returnTime: new Date(Date.now() + 7200000).toISOString(),
                emergencyContact: '1234567890'
            }
        };
        const res = makeMockRes();
        await exitPassesController.apply(req, res);
        
        assert.strictEqual(res.statusCode, 201, 'Should create pass successfully');
        assert.strictEqual(res.body.studentId, studentA.id, 'Pass must be created for session studentId, NOT body studentId');
    }

    // --- TEST CASE 2: Concurrency & Idempotency in Decisions (Approve/Reject retry) ---
    console.log('\n[Test 2] Verifying atomic idempotency on double approval/reject retry...');
    {
        const pass = await prisma.exitPass.create({
            data: {
                studentId: studentA.id,
                destination: 'Shop',
                reason: 'Grocery',
                exitTime: new Date(Date.now() + 3600000),
                returnTime: new Date(Date.now() + 7200000),
                emergencyContact: '1234567890',
                status: 'PENDING',
                requestedDate: 'Jul 15, 2026'
            }
        });

        const testAdmin = await prisma.admin.findFirst();
        if (!testAdmin) {
            throw new Error('[Setup] No admin found in database. Run npm run seed:demo first.');
        }

        // 1st approval
        const req1 = { params: { id: pass.id }, admin: { email: testAdmin.email, id: testAdmin.id }, body: { adminRemark: 'First remark' } };
        const res1 = makeMockRes();
        await exitPassesController.approve(req1, res1);
        assert.strictEqual(res1.statusCode, 200);

        // Fetch notifications count
        const countAfterApprove1 = await prisma.notification.count({ where: { studentId: studentA.id, title: 'Exit Pass Approved' } });
        assert.strictEqual(countAfterApprove1, 1, 'Should create exactly 1 approval notification');

        // Retry approval (Idempotent 200 success, no state error)
        const res2 = makeMockRes();
        await exitPassesController.approve(req1, res2);
        assert.strictEqual(res2.statusCode, 200, 'Retry approval should succeed idempotently');

        const countAfterApprove2 = await prisma.notification.count({ where: { studentId: studentA.id, title: 'Exit Pass Approved' } });
        assert.strictEqual(countAfterApprove2, 1, 'Should NOT create duplicate notification record on idempotent retry');

        // Now attempt to reject already approved pass -> should return 409 conflict
        const reqReject = { params: { id: pass.id }, admin: { email: 'admin@sitam.edu' }, body: { reason: 'Rejecting approved' } };
        const resReject = makeMockRes();
        await exitPassesController.reject(reqReject, resReject);
        assert.strictEqual(resReject.statusCode, 409, 'Rejecting approved pass should return 409 Conflict');
    }

    // --- TEST CASE 3: Student Cancelling Approved/Used/Expired Passes ---
    console.log('\n[Test 3] Verifying cancel limits on non-pending exit passes...');
    {
        // 1. Cancel Approved Pass
        const approvedPass = await prisma.exitPass.create({
            data: {
                studentId: studentA.id,
                destination: 'Bank',
                reason: 'Withdrawal',
                exitTime: new Date(Date.now() + 3600000),
                returnTime: new Date(Date.now() + 7200000),
                emergencyContact: '1234567890',
                status: 'APPROVED',
                requestedDate: 'Jul 15, 2026'
            }
        });

        const reqCancel = { params: { id: approvedPass.id }, session: { studentId: studentA.id, userId: studentA.userId } };
        const resCancel = makeMockRes();
        await exitPassesController.cancel(reqCancel, resCancel);
        assert.strictEqual(resCancel.statusCode, 409, 'Cannot cancel APPROVED pass');

        // 2. Cancel USED Pass
        const usedPass = await prisma.exitPass.create({
            data: {
                studentId: studentA.id,
                destination: 'Hospital',
                reason: 'Checkup',
                exitTime: new Date(Date.now() + 3600000),
                returnTime: new Date(Date.now() + 7200000),
                emergencyContact: '1234567890',
                status: 'USED',
                requestedDate: 'Jul 15, 2026'
            }
        });

        const resCancelUsed = makeMockRes();
        await exitPassesController.cancel({ params: { id: usedPass.id }, session: { studentId: studentA.id, userId: studentA.userId } }, resCancelUsed);
        assert.strictEqual(resCancelUsed.statusCode, 409, 'Cannot cancel USED pass');
    }

    // --- TEST CASE 4: Draft Notifications Visibility ---
    console.log('\n[Test 4] Verifying draft notifications are invisible to students...');
    {
        // Create draft notification
        const draft = await prisma.adminNotification.create({
            data: {
                title: 'TEST_Draft Alert',
                message: 'Should not see this',
                targetAudience: 'ALL',
                status: 'DRAFT',
                priority: 'NORMAL',
                sentBy: 'admin@sitam.edu'
            }
        });

        // Request student feed
        const reqFeed = { session: { userId: studentA.userId }, query: {} };
        const resFeed = makeMockRes();
        await dataControllers.getNotifications(reqFeed, resFeed, (err) => { if(err) throw err; });

        const visibleDraft = resFeed.body.notifications.find(n => n.id === draft.id);
        assert.strictEqual(visibleDraft, undefined, 'Draft notification must be invisible in student feed');
    }

    // --- TEST CASE 5: Targeted Notifications Accessibility ---
    console.log('\n[Test 5] Verifying targeted notifications accessibility...');
    {
        // Create notification targeted exclusively to Student A
        const targeted = await prisma.adminNotification.create({
            data: {
                title: 'TEST_Personal A',
                message: 'Hello A',
                targetAudience: 'STUDENT',
                targetStudentId: studentA.id,
                status: 'PUBLISHED',
                priority: 'NORMAL',
                sentBy: 'admin@sitam.edu'
            }
        });

        // Fetch feed for Student B (Should NOT see Student A's notification)
        const reqFeedB = { session: { userId: studentB.userId }, query: {} };
        const resFeedB = makeMockRes();
        await dataControllers.getNotifications(reqFeedB, resFeedB, (err) => { if(err) throw err; });

        const foundInB = resFeedB.body.notifications.find(n => n.id === targeted.id);
        assert.strictEqual(foundInB, undefined, 'Student B must not see notification targeted to Student A');

        // Fetch feed for Student A (Should see it)
        const reqFeedA = { session: { userId: studentA.userId }, query: {} };
        const resFeedA = makeMockRes();
        await dataControllers.getNotifications(reqFeedA, resFeedA, (err) => { if(err) throw err; });

        const foundInA = resFeedA.body.notifications.find(n => n.id === targeted.id);
        assert.ok(foundInA, 'Student A should see their targeted notification');
    }

    // --- TEST CASE 6: Expiry Validation for Broadcast Notifications ---
    console.log('\n[Test 6] Verifying expired broadcasts are excluded from feed, counts, and markRead...');
    {
        const reqFeed = { session: { userId: studentA.userId }, query: {} };

        // 1. Get initial unread count
        const resInitialUnread = makeMockRes();
        await dataControllers.getUnreadCount(reqFeed, resInitialUnread, (err) => { if(err) throw err; });
        const initialCount = resInitialUnread.body.count;

        // Create expired broadcast
        const expired = await prisma.adminNotification.create({
            data: {
                title: 'TEST_Expired Announcement',
                message: 'Expired long ago',
                targetAudience: 'ALL',
                status: 'PUBLISHED',
                priority: 'NORMAL',
                sentBy: 'admin@sitam.edu',
                expiresAt: new Date(Date.now() - 10000) // 10 seconds ago
            }
        });

        // 2. Excluded from Student Feed
        const resFeed = makeMockRes();
        await dataControllers.getNotifications(reqFeed, resFeed, (err) => { if(err) throw err; });
        const visibleExpired = resFeed.body.notifications.find(n => n.id === expired.id);
        assert.strictEqual(visibleExpired, undefined, 'Expired notification must be excluded from student feed');

        // 3. Excluded from Unread Count (should match initialCount)
        const resUnread = makeMockRes();
        await dataControllers.getUnreadCount(reqFeed, resUnread, (err) => { if(err) throw err; });
        assert.strictEqual(resUnread.body.count, initialCount, 'Unread count should not increase for expired notifications');

        // 4. Mark Read attempt on expired should fail/404
        const reqMark = { session: { userId: studentA.userId }, body: { notificationId: expired.id } };
        const resMark = makeMockRes();
        await dataControllers.markRead(reqMark, resMark, (err) => { if(err) throw err; });
        assert.ok(resMark.statusCode !== 200, 'Attempting to mark expired notification read should fail');
    }

    console.log('\n=== All Tests Passed Successfully! ===');
    await prisma.$disconnect();
    process.exit(0);
}

runTests().catch(err => {
    console.error('\n!!! TEST FAILURE !!!');
    console.error(err);
    process.exit(1);
});
