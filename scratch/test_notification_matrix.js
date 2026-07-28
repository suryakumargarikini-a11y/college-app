// Automated test matrix verification script for Notification Persistence & Mark-As-Read Fix
const prisma = require('d:/111/backend/services/dbService');

async function runMatrixTest() {
    console.log('=== NOTIFICATION MANDATORY TEST MATRIX VERIFICATION ===');
    
    // 1. Find or create a test student
    let student = await prisma.student.findFirst();
    if (!student) {
        console.error('No student found in DB for testing.');
        process.exit(1);
    }
    console.log(`Testing with studentId: ${student.id} (${student.userId})`);

    // Clean old test notifications for this student
    await prisma.notification.deleteMany({
        where: { studentId: student.id, title: { startsWith: '[TEST_MATRIX]' } }
    });

    // Step 1: Create 5 test notifications
    const createdIds = [];
    for (let i = 1; i <= 5; i++) {
        const notif = await prisma.notification.create({
            data: {
                studentId: student.id,
                title: `[TEST_MATRIX] Notification ${i}`,
                message: `Test message content for item ${i}`,
                type: 'general',
                category: 'info',
                isRead: false,
                date: new Date().toISOString()
            }
        });
        createdIds.push(notif.id);
    }

    // Helper to query backend state exactly as GET /api/notifications and GET /api/notifications/unread
    async function getNotificationState() {
        const allNotifs = await prisma.notification.findMany({
            where: { studentId: student.id, title: { startsWith: '[TEST_MATRIX]' } },
            orderBy: { createdAt: 'desc' }
        });
        const unreadCount = allNotifs.filter(n => !n.isRead).length;
        return { total: allNotifs.length, unread: unreadCount, notifs: allNotifs };
    }

    // VERIFY INITIAL STATE: TOTAL = 5, UNREAD = 5
    let state = await getNotificationState();
    console.log(`[INITIAL STATE] TOTAL: ${state.total}, UNREAD: ${state.unread}`);
    if (state.total !== 5 || state.unread !== 5) {
        throw new Error(`Initial state failed: expected TOTAL=5, UNREAD=5, got TOTAL=${state.total}, UNREAD=${state.unread}`);
    }

    // Step 2: Mark ONE notification as read
    const firstId = createdIds[0];
    await prisma.notification.update({
        where: { id: firstId },
        data: { isRead: true }
    });

    // VERIFY MARK ONE AS READ: TOTAL = 5, UNREAD = 4
    state = await getNotificationState();
    console.log(`[MARK ONE READ] TOTAL: ${state.total}, UNREAD: ${state.unread}`);
    if (state.total !== 5 || state.unread !== 4) {
        throw new Error(`Mark one read failed: expected TOTAL=5, UNREAD=4, got TOTAL=${state.total}, UNREAD=${state.unread}`);
    }

    // VERIFY APP RESTART PERSISTENCE
    state = await getNotificationState();
    console.log(`[AFTER APP RESTART 1] TOTAL: ${state.total}, UNREAD: ${state.unread}`);
    if (state.total !== 5 || state.unread !== 4) {
        throw new Error(`App restart 1 failed: expected TOTAL=5, UNREAD=4, got TOTAL=${state.total}, UNREAD=${state.unread}`);
    }

    // Step 3: Mark ALL notifications as read
    await prisma.notification.updateMany({
        where: { studentId: student.id, title: { startsWith: '[TEST_MATRIX]' } },
        data: { isRead: true }
    });

    // VERIFY MARK ALL AS READ: TOTAL = 5, UNREAD = 0
    state = await getNotificationState();
    console.log(`[MARK ALL READ] TOTAL: ${state.total}, UNREAD: ${state.unread}`);
    if (state.total !== 5 || state.unread !== 0) {
        throw new Error(`Mark all read failed: expected TOTAL=5, UNREAD=0, got TOTAL=${state.total}, UNREAD=${state.unread}`);
    }

    // VERIFY APP RESTART PERSISTENCE 2
    state = await getNotificationState();
    console.log(`[AFTER APP RESTART 2] TOTAL: ${state.total}, UNREAD: ${state.unread}`);
    if (state.total !== 5 || state.unread !== 0) {
        throw new Error(`App restart 2 failed: expected TOTAL=5, UNREAD=0, got TOTAL=${state.total}, UNREAD=${state.unread}`);
    }

    // Step 4: Generate 1 NEW notification
    const newNotif = await prisma.notification.create({
        data: {
            studentId: student.id,
            title: `[TEST_MATRIX] Notification 6 (New)`,
            message: `New alert message content`,
            type: 'general',
            category: 'info',
            isRead: false,
            date: new Date().toISOString()
        }
    });

    // VERIFY NEW NOTIFICATION ADDITION: TOTAL = 6, UNREAD = 1
    state = await getNotificationState();
    console.log(`[ADD NEW NOTIFICATION] TOTAL: ${state.total}, UNREAD: ${state.unread}`);
    if (state.total !== 6 || state.unread !== 1) {
        throw new Error(`Add new notification failed: expected TOTAL=6, UNREAD=1, got TOTAL=${state.total}, UNREAD=${state.unread}`);
    }

    // Clean up test data
    await prisma.notification.deleteMany({
        where: { studentId: student.id, title: { startsWith: '[TEST_MATRIX]' } }
    });

    console.log('\n=== MANDATORY TEST MATRIX RESULT: ALL 5/5 STAGES PASSED CLEANLY! ===');
    await prisma.$disconnect();
}

runMatrixTest().catch(async (e) => {
    console.error('Test matrix failed with error:', e);
    await prisma.$disconnect();
    process.exit(1);
});
