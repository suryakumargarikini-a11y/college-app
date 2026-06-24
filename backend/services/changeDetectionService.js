const crypto = require('crypto');
const prisma = require('./dbService');
const logger = require('./logger');
const firebaseService = require('./firebaseService');
const socketService = require('./socketService');

function computeHash(studentId, eventType, stableKey, newValue) {
    const data = `${studentId}:${eventType}:${stableKey}:${newValue}`;
    return crypto.createHash('sha256').update(data).digest('hex');
}

class ChangeDetectionService {
    async detectAndNotify(userId, studentBefore, studentAfter) {
        if (!studentBefore || !studentAfter) {
            logger.info(`[ChangeDetection] Missing student records for comparison. Skipping detection.`);
            return;
        }

        const isFirstSync = !studentBefore.lastSync || 
                            (!studentBefore.attendance || studentBefore.attendance.length === 0) ||
                            (!studentBefore.marks || studentBefore.marks.length === 0);
        
        if (isFirstSync) {
            logger.info(`[ChangeDetection] First-time sync detected for ${userId}. Skipping change notifications.`);
            return;
        }

        const studentId = studentAfter.id;
        const events = [];

        // 1. Profile / Semester Promotion
        if (studentBefore.semester !== studentAfter.semester) {
            events.push({
                eventType: 'semester_promoted',
                stableKey: 'semester',
                oldValue: studentBefore.semester,
                newValue: studentAfter.semester,
                title: 'Semester Promotion',
                message: `Congratulations! You have been promoted to Semester ${studentAfter.semester}.`,
                type: 'timetable',
                category: 'success',
                metadata: { semester: studentAfter.semester },
                route: '/timetable'
            });
        }

        // 2. CGPA Changes
        if (studentBefore.cgpa !== studentAfter.cgpa) {
            events.push({
                eventType: 'cgpa_changed',
                stableKey: 'cgpa',
                oldValue: studentBefore.cgpa,
                newValue: studentAfter.cgpa,
                title: 'CGPA Update',
                message: `Your cumulative CGPA has updated from ${studentBefore.cgpa} to ${studentAfter.cgpa}.`,
                type: 'marks',
                category: 'update',
                metadata: { oldCgpa: studentBefore.cgpa, newCgpa: studentAfter.cgpa },
                route: '/marks'
            });
        }

        // 3. Attendance Changes
        const beforeAttendanceMap = new Map((studentBefore.attendance || []).map(a => [a.subject.code.toUpperCase(), a]));
        const afterAttendanceMap = new Map((studentAfter.attendance || []).map(a => [a.subject.code.toUpperCase(), a]));

        for (const [code, newRecord] of afterAttendanceMap.entries()) {
            const oldRecord = beforeAttendanceMap.get(code);
            if (oldRecord) {
                if (oldRecord.percentage !== newRecord.percentage) {
                    const subjectName = newRecord.subject.name || code;
                    const diff = newRecord.percentage - oldRecord.percentage;
                    const direction = diff > 0 ? 'increased' : 'dropped';
                    const category = newRecord.percentage < 75 && diff < 0 ? 'alert' : (diff > 0 ? 'success' : 'update');
                    const eventType = diff > 0 ? 'attendance_increased' : 'attendance_dropped';

                    events.push({
                        eventType,
                        stableKey: `attendance:${code}`,
                        oldValue: `${oldRecord.percentage}`,
                        newValue: `${newRecord.percentage}`,
                        title: `Attendance Update: ${code}`,
                        message: `Your attendance in ${subjectName} ${direction} to ${newRecord.percentage}%.`,
                        type: 'attendance',
                        category,
                        metadata: { subjectCode: code, percentage: newRecord.percentage, diff },
                        route: '/attendance'
                    });
                }
            }
        }

        // 4. Marks Changes
        const beforeMarksMap = new Map((studentBefore.marks || []).map(m => [m.subject.code.toUpperCase(), m]));
        const afterMarksMap = new Map((studentAfter.marks || []).map(m => [m.subject.code.toUpperCase(), m]));

        for (const [code, newRecord] of afterMarksMap.entries()) {
            const oldRecord = beforeMarksMap.get(code);
            if (oldRecord) {
                if (oldRecord.grade !== newRecord.grade || oldRecord.marks !== newRecord.marks) {
                    const subjectName = newRecord.subject.name || code;
                    events.push({
                        eventType: 'marks_updated',
                        stableKey: `marks:${code}`,
                        oldValue: JSON.stringify({ grade: oldRecord.grade, marks: oldRecord.marks }),
                        newValue: JSON.stringify({ grade: newRecord.grade, marks: newRecord.marks }),
                        title: `Marks Published: ${code}`,
                        message: `New grade/marks updated for ${subjectName}: Grade ${newRecord.grade || 'N/A'}.`,
                        type: 'marks',
                        category: 'update',
                        metadata: { subjectCode: code, grade: newRecord.grade, marks: newRecord.marks },
                        route: '/marks'
                    });
                }
            }
        }

        // 5. Fees Changes
        const beforeFeesMap = new Map((studentBefore.fees || []).map(f => [f.feeType.toUpperCase(), f]));
        const afterFeesMap = new Map((studentAfter.fees || []).map(f => [f.feeType.toUpperCase(), f]));

        for (const [feeType, newRecord] of afterFeesMap.entries()) {
            const oldRecord = beforeFeesMap.get(feeType);
            if (oldRecord) {
                if (oldRecord.dueAmount !== newRecord.dueAmount || oldRecord.paymentStatus !== newRecord.paymentStatus) {
                    const amountDiff = newRecord.dueAmount - oldRecord.dueAmount;
                    if (amountDiff > 0) {
                        events.push({
                            eventType: 'fee_due',
                            stableKey: `fee:due:${feeType}`,
                            oldValue: `${oldRecord.dueAmount}`,
                            newValue: `${newRecord.dueAmount}`,
                            title: `Fee Due: ${newRecord.feeType}`,
                            message: `You have an outstanding due of ₹${newRecord.dueAmount} for ${newRecord.feeType}.`,
                            type: 'fees',
                            category: 'alert',
                            metadata: { feeType: newRecord.feeType, dueAmount: newRecord.dueAmount },
                            route: '/fees'
                        });
                    } else if (newRecord.paymentStatus === 'Paid' || newRecord.paymentStatus === 'Completed' || newRecord.dueAmount === 0) {
                        events.push({
                            eventType: 'fee_paid',
                            stableKey: `fee:paid:${feeType}`,
                            oldValue: `${oldRecord.dueAmount}`,
                            newValue: `${newRecord.dueAmount}`,
                            title: `Fee Payment Success`,
                            message: `Payment received for ${newRecord.feeType}. Status: ${newRecord.paymentStatus}.`,
                            type: 'fees',
                            category: 'success',
                            metadata: { feeType: newRecord.feeType, dueAmount: newRecord.dueAmount },
                            route: '/fees'
                        });
                    }
                }
            } else {
                // New fee line added
                events.push({
                    eventType: 'fee_created',
                    stableKey: `fee:new:${feeType}`,
                    oldValue: null,
                    newValue: `${newRecord.dueAmount}`,
                    title: `New Fee Statement: ${newRecord.feeType}`,
                    message: `New fee ledger generated: ₹${newRecord.amount} due by ${newRecord.dueDate}.`,
                    type: 'fees',
                    category: 'alert',
                    metadata: { feeType: newRecord.feeType, amount: newRecord.amount, dueAmount: newRecord.dueAmount },
                    route: '/fees'
                });
            }
        }

        // 6. Assignments Changes
        const getAssignmentKey = (a) => `${a.subject.toUpperCase()}:${a.title.toUpperCase()}`;
        const beforeAssignmentsMap = new Map((studentBefore.assignments || []).map(a => [getAssignmentKey(a), a]));
        const afterAssignmentsMap = new Map((studentAfter.assignments || []).map(a => [getAssignmentKey(a), a]));

        for (const [key, newRecord] of afterAssignmentsMap.entries()) {
            const oldRecord = beforeAssignmentsMap.get(key);
            if (oldRecord) {
                if (oldRecord.date !== newRecord.date) {
                    events.push({
                        eventType: 'assignment_deadline_changed',
                        stableKey: `assignment:deadline:${key}`,
                        oldValue: oldRecord.date,
                        newValue: newRecord.date,
                        title: `Assignment Deadline Update: ${newRecord.subject}`,
                        message: `The deadline for "${newRecord.title}" has changed to ${newRecord.date}.`,
                        type: 'assignments',
                        category: 'reminder',
                        metadata: { title: newRecord.title, subject: newRecord.subject, dueDate: newRecord.date },
                        route: '/assignments'
                    });
                }
                if (oldRecord.status !== newRecord.status) {
                    events.push({
                        eventType: 'assignment_status_changed',
                        stableKey: `assignment:status:${key}`,
                        oldValue: oldRecord.status,
                        newValue: newRecord.status,
                        title: `Assignment Updated: ${newRecord.subject}`,
                        message: `Assignment "${newRecord.title}" status changed to ${newRecord.status}.`,
                        type: 'assignments',
                        category: 'success',
                        metadata: { title: newRecord.title, subject: newRecord.subject, status: newRecord.status },
                        route: '/assignments'
                    });
                }
            } else {
                // New assignment
                events.push({
                    eventType: 'new_assignment',
                    stableKey: `assignment:new:${key}`,
                    oldValue: null,
                    newValue: newRecord.date,
                    title: `New Assignment: ${newRecord.subject}`,
                    message: `Assignment "${newRecord.title}" has been posted. Due: ${newRecord.date}.`,
                    type: 'assignments',
                    category: 'update',
                    metadata: { title: newRecord.title, subject: newRecord.subject, dueDate: newRecord.date },
                    route: '/assignments'
                });
            }
        }

        // 7. Timetable Changes
        const getTimetableKey = (t) => `${t.day.toUpperCase()}:${t.period}`;
        const beforeTimetableMap = new Map((studentBefore.timetable || []).map(t => [getTimetableKey(t), t]));
        const afterTimetableMap = new Map((studentAfter.timetable || []).map(t => [getTimetableKey(t), t]));

        for (const [key, newRecord] of afterTimetableMap.entries()) {
            const oldRecord = beforeTimetableMap.get(key);
            if (oldRecord) {
                if (oldRecord.room !== newRecord.room || 
                    oldRecord.facultyName !== newRecord.facultyName || 
                    oldRecord.time !== newRecord.time) {
                    
                    const subjectCode = newRecord.subject?.code || 'Subject';
                    events.push({
                        eventType: 'timetable_changed',
                        stableKey: `timetable:${key}`,
                        oldValue: JSON.stringify({ room: oldRecord.room, faculty: oldRecord.facultyName, time: oldRecord.time }),
                        newValue: JSON.stringify({ room: newRecord.room, faculty: newRecord.facultyName, time: newRecord.time }),
                        title: `Timetable Revision: ${newRecord.day}`,
                        message: `Period ${newRecord.period} (${subjectCode}) is now in ${newRecord.room} with ${newRecord.facultyName}.`,
                        type: 'timetable',
                        category: 'update',
                        metadata: { day: newRecord.day, period: newRecord.period, subjectCode, room: newRecord.room, facultyName: newRecord.facultyName },
                        route: '/timetable'
                    });
                }
            }
        }

        // Process all detected events
        let newNotificationAdded = false;
        
        for (const ev of events) {
            const hash = computeHash(studentId, ev.eventType, ev.stableKey, JSON.stringify(ev.newValue));
            
            try {
                // Idempotent insertion using exists check to avoid duplicates at DB-level
                const exists = await prisma.notificationEvent.findUnique({
                    where: { changeHash: hash }
                });

                if (exists) {
                    continue;
                }

                // Create the NotificationEvent and the corresponding Notification
                await prisma.$transaction(async (tx) => {
                    await tx.notificationEvent.create({
                        data: {
                            studentId,
                            eventType: ev.eventType,
                            changeHash: hash,
                            oldValue: ev.oldValue ? String(ev.oldValue) : null,
                            newValue: ev.newValue ? String(ev.newValue) : null,
                            metadata: ev.metadata ? JSON.stringify(ev.metadata) : null,
                            notified: true
                        }
                    });

                    await tx.notification.create({
                        data: {
                            studentId,
                            title: ev.title,
                            message: ev.message,
                            type: ev.type,
                            category: ev.category,
                            metadata: ev.metadata ? JSON.stringify(ev.metadata) : null,
                            changeHash: hash,
                            date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                        }
                    });
                });

                newNotificationAdded = true;
                logger.info(`[ChangeDetection] Registered event and created notification: ${ev.title} for student ${userId}`);

                // Send Firebase Push Notification
                await firebaseService.sendPushNotification(userId, ev.title, ev.message, {
                    route: ev.route,
                    type: ev.type,
                    category: ev.category,
                    ...(ev.metadata || {})
                }).catch(err => {
                    logger.error(`[ChangeDetection] FCM send failed for event: ${ev.title}. Error: ${err.message}`);
                });

                // Send WebSocket Live Update
                socketService.sendToUser(userId, `${ev.type}_update`, {
                    title: ev.title,
                    message: ev.message,
                    type: ev.type,
                    category: ev.category,
                    metadata: ev.metadata
                });

            } catch (err) {
                logger.error(`[ChangeDetection] Failed to process change event: ${err.message}`);
            }
        }

        if (newNotificationAdded) {
            socketService.sendToUser(userId, 'notification_refresh', { count: 1 });
        }
    }
}

module.exports = new ChangeDetectionService();
