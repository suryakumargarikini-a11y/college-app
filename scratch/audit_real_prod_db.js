'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '../backend/.env') });
const prisma = require('../backend/services/dbService');

async function auditProdDb() {
    process.stdout.write('====================================================\n');
    process.stdout.write('     REAL PRODUCTION POSTGRESQL DATABASE AUDIT      \n');
    process.stdout.write('====================================================\n');

    try {
        const studentCount = await prisma.student.count();
        const adminCount = await prisma.admin.count();
        const attendanceCount = await prisma.attendanceRecord.count();
        const markCount = await prisma.markRecord.count();
        const timetableCount = await prisma.timetableSlot.count();
        const feeCount = await prisma.fee.count();
        const exitPassCount = await prisma.exitPass.count();
        const notificationCount = await prisma.notification.count();
        const libraryCount = await prisma.libraryMaterial.count();
        const lmsAssignmentCount = await prisma.lmsAssignment.count();
        const lmsSubmissionCount = await prisma.lmsSubmission.count();
        const achievementCount = await prisma.achievement.count();

        process.stdout.write(`- Students Count          : ${studentCount}\n`);
        process.stdout.write(`- Admins Count            : ${adminCount}\n`);
        process.stdout.write(`- Attendance Records      : ${attendanceCount}\n`);
        process.stdout.write(`- Mark Records            : ${markCount}\n`);
        process.stdout.write(`- Timetable Slots         : ${timetableCount}\n`);
        process.stdout.write(`- Fee Records             : ${feeCount}\n`);
        process.stdout.write(`- Exit Pass Records       : ${exitPassCount}\n`);
        process.stdout.write(`- Notification Records   : ${notificationCount}\n`);
        process.stdout.write(`- Library Materials       : ${libraryCount}\n`);
        process.stdout.write(`- LMS Assignments         : ${lmsAssignmentCount}\n`);
        process.stdout.write(`- LMS Submissions         : ${lmsSubmissionCount}\n`);
        process.stdout.write(`- Achievements            : ${achievementCount}\n`);

    } catch (e) {
        process.stdout.write(`Error auditing production DB: ${e.message}\n`);
    } finally {
        process.exit(0);
    }
}

auditProdDb();
