const prisma = require('../services/dbService');
const changeDetectionService = require('../services/changeDetectionService');

async function runTest() {
    console.log('=== Starting Notification & Change Detection Test ===');
    const userId = 'TEST-USER-NOTIF';

    try {
        // 1. Clean up previous test run
        await prisma.notification.deleteMany({ where: { student: { userId } } });
        await prisma.notificationEvent.deleteMany({ where: { student: { userId } } });
        await prisma.student.deleteMany({ where: { userId } });
        await prisma.subject.deleteMany({ where: { code: 'SUBJ-A' } });

        console.log('\n[1] Creating initial student...');
        const student = await prisma.student.create({
            data: {
                userId,
                password: 'password123',
                name: 'Test Student Notifications',
                roll: userId,
                program: 'B.Tech',
                branch: 'CSE',
                semester: 'III Semester',
                year: 'Year 2',
                gender: 'Male',
                dob: '2005-01-01',
                email: 'test@notif.com',
                phone: '1234567890',
                fatherName: 'Father',
                motherName: 'Mother',
                fatherMobile: '0987654321',
                hostel: 'Hostel A',
                roomNo: '202',
                cgpa: '8.0',
                percentage: '80%',
                address: 'SITAM Campus',
                lastSync: null // Represents first login
            }
        });

        const subject = await prisma.subject.create({
            data: {
                code: 'SUBJ-A',
                name: 'SITAM Software Engineering',
                credits: '3.0',
                semester: 'III Semester'
            }
        });

        // 2. Add initial relations
        await prisma.attendanceRecord.create({
            data: {
                studentId: student.id,
                subjectId: subject.id,
                held: 10,
                attended: 8,
                percentage: 80.0,
                status: 'Good'
            }
        });

        await prisma.markRecord.create({
            data: {
                studentId: student.id,
                subjectId: subject.id,
                grade: 'A',
                credits: '3.0',
                type: 'Core',
                status: 'Pass'
            }
        });

        // 3. First sync check (should skip because lastSync is null)
        const studentBeforeNullLastSync = await prisma.student.findUnique({
            where: { userId },
            include: {
                fees: true,
                attendance: { include: { subject: true } },
                marks: { include: { subject: true } },
                assignments: true,
                timetable: { include: { subject: true } }
            }
        });

        console.log('[2] Running change detection for first sync (lastSync = null)...');
        await changeDetectionService.detectAndNotify(userId, null, studentBeforeNullLastSync);

        let notifCount = await prisma.notification.count({ where: { studentId: student.id } });
        console.log(`- Notifications created: ${notifCount} (Expected: 0)`);
        if (notifCount !== 0) throw new Error('First sync should not trigger change alerts');

        // 4. Update lastSync to simulate subsequent syncs
        await prisma.student.update({
            where: { id: student.id },
            data: { lastSync: new Date() }
        });

        // Load baseline state
        const studentBefore = await prisma.student.findUnique({
            where: { userId },
            include: {
                fees: true,
                attendance: { include: { subject: true } },
                marks: { include: { subject: true } },
                assignments: true,
                timetable: { include: { subject: true } }
            }
        });

        console.log(`\n[3] Baseline state captured. CGPA = ${studentBefore.cgpa}, Subject A attendance = ${studentBefore.attendance[0].percentage}%`);

        // 5. Trigger Changes in DB (CGPA updates, Subject A attendance drops, add a new assignment)
        console.log('\n[4] Triggering state modifications...');
        await prisma.student.update({
            where: { id: student.id },
            data: { cgpa: '8.4' }
        });

        await prisma.attendanceRecord.updateMany({
            where: { studentId: student.id },
            data: { percentage: 70.0, held: 10, attended: 7, status: 'Warning' }
        });

        await prisma.assignment.create({
            data: {
                studentId: student.id,
                title: 'Design Principles Project',
                subject: 'SUBJ-A',
                status: 'Pending',
                date: 'June 30, 2026'
            }
        });

        // Load modified state
        const studentAfter = await prisma.student.findUnique({
            where: { userId },
            include: {
                fees: true,
                attendance: { include: { subject: true } },
                marks: { include: { subject: true } },
                assignments: true,
                timetable: { include: { subject: true } }
            }
        });

        console.log(`- New state captured. CGPA = ${studentAfter.cgpa}, Subject A attendance = ${studentAfter.attendance[0].percentage}%`);

        // 6. Run Change Detection
        console.log('\n[5] Executing Change Detection Engine...');
        await changeDetectionService.detectAndNotify(userId, studentBefore, studentAfter);

        // 7. Verify Notifications Created
        console.log('\n[6] Verifying generated notifications...');
        const notifications = await prisma.notification.findMany({
            where: { studentId: student.id }
        });
        
        console.log(`- Total notifications in database: ${notifications.length} (Expected: 3)`);
        notifications.forEach(n => {
            console.log(`  * [${n.type} / ${n.category}] ${n.title} - ${n.message}`);
        });

        if (notifications.length !== 3) throw new Error('Expected exactly 3 notifications (CGPA change, attendance dropped, and new assignment)');

        // 8. Test De-duplication (Run same detection block again)
        console.log('\n[7] Re-running same change detection to verify de-duplication...');
        await changeDetectionService.detectAndNotify(userId, studentBefore, studentAfter);

        const dupNotifCount = await prisma.notification.count({ where: { studentId: student.id } });
        console.log(`- Total notifications after duplicate run: ${dupNotifCount} (Expected: 3)`);
        if (dupNotifCount !== 3) throw new Error('De-duplication failed! Pushed duplicate events.');
        console.log('✅ De-duplication validation PASSED!');

        // 9. Clean up database
        console.log('\n[8] Cleaning up database...');
        await prisma.notification.deleteMany({ where: { studentId: student.id } });
        await prisma.notificationEvent.deleteMany({ where: { studentId: student.id } });
        await prisma.student.delete({ where: { id: student.id } });
        await prisma.subject.delete({ where: { id: subject.id } });
        console.log('✅ Cleanup successful.');

        console.log('\nALL NOTIFICATION & CHANGE DETECTION TESTS PASSED SUCCESSFULLY! 🚀🎉');

    } catch (err) {
        console.error('❌ Notification Verification FAILED:', err);
    } finally {
        await prisma.$disconnect();
    }
}

runTest();
