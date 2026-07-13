const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), override: true });

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function check() {
    try {
        const result = await prisma.$queryRawUnsafe('SELECT 1 as ok');
        console.log('DB: Connected OK', result);

        const studentCount = await prisma.student.count();
        console.log('Students:', studentCount);

        const sessionCount = await prisma.session.count();
        console.log('Sessions:', sessionCount);

        const notifCount = await prisma.notification.count();
        console.log('Notifications:', notifCount);

        const feeCount = await prisma.fee.count();
        console.log('Fees:', feeCount);

        const adminCount = await prisma.admin.count();
        console.log('Admins:', adminCount);

        const markCount = await prisma.markRecord.count();
        console.log('MarkRecords:', markCount);

        const attendCount = await prisma.attendanceRecord.count();
        console.log('AttendanceRecords:', attendCount);

        const fcmCount = await prisma.fcmToken.count();
        console.log('FcmTokens:', fcmCount);

        const exitPassCount = await prisma.exitPass.count();
        console.log('ExitPasses:', exitPassCount);

        await prisma.$disconnect();
        console.log('\n=== DB CHECK PASSED ===');
    } catch (e) {
        console.error('DB ERROR:', e.message);
        await prisma.$disconnect();
        process.exit(1);
    }
}

check();
