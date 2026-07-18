const prisma = require('../services/dbService');
const logger = require('../services/logger');

const studentRepository = {
    async findByUserId(userId) {
        const student = await prisma.student.findUnique({
            where: { userId },
            include: {
                marks: { include: { subject: true } },
                attendance: { include: { subject: true } },
                timetable: { include: { subject: true } },
                assignments: true,
                notifications: true,
                fees: true
            }
        });
        if (student && student.password) {
            const cryptoHelper = require('../services/cryptoHelper');
            student.password = cryptoHelper.decrypt(student.password);
        }
        return student;
    },

    async upsertStudent(userId, data) {
        logger.info(`Repository: Upserting student ${userId}`);
        const rollNum = data.roll || '';
        const sec = data.section || 'A';
        const cryptoHelper = require('../services/cryptoHelper');
        const encryptedPassword = cryptoHelper.encrypt(data.password);

        // Shared field payload — used for both create and update to avoid drift
        const profileFields = {
            password:              encryptedPassword,
            name:                  data.name,
            roll:                  data.roll,
            roll_number:           rollNum,
            section:               sec,
            program:               data.program,
            branch:                data.branch,
            semester:              data.semester,
            year:                  data.year,
            gender:                data.gender,
            dob:                   data.dob,
            email:                 data.email,
            phone:                 data.phone,
            fatherName:            data.fatherName,
            motherName:            data.motherName,
            fatherMobile:          data.fatherMobile || '',
            hostel:                data.hostel,
            roomNo:                data.roomNo,
            cgpa:                  data.cgpa,
            sgpa:                  data.sgpa                  || '',
            percentage:            data.percentage,
            address:               data.address,
            bloodGroup:            data.bloodGroup             || '',
            emergencyContact:      data.emergencyContact       || '',
            admissionNo:           data.admissionNo            || '',
            joiningDate:           data.joiningDate            || '',
            caste:                 data.caste                  || '',
            nationality:           data.nationality            || '',
            religion:              data.religion               || '',
            sscMarks:              data.sscMarks               || '',
            interMarks:            data.interMarks             || '',
            scholarship:           data.scholarship            || '',
            seatType:              data.seatType               || '',
            entranceType:          data.entranceType           || '',
            entranceRank:          data.entranceRank           || '',
            aadhar:                data.aadhar                 || '',
            apaarId:               data.apaarId                || '',
            photoUrl:              data.photoUrl               || '',
            guardianName:          data.guardianName           || '',
            guardianPhone:         data.guardianPhone          || '',
            guardianAddress:       data.guardianAddress        || '',
            // Extended fields (Phase 1)
            motherMobile:          data.motherMobile           || '',
            annualIncome:          data.annualIncome           || '',
            fatherEmail:           data.fatherEmail            || '',
            motherEmail:           data.motherEmail            || '',
            fatherOccupation:      data.fatherOccupation       || '',
            motherOccupation:      data.motherOccupation       || '',
            correspondenceAddress: data.correspondenceAddress  || '',
            lastStudied:           data.lastStudied            || '',
            academicYear:          data.academicYear           || '',
        };

        return prisma.student.upsert({
            where:  { userId },
            update: profileFields,
            create: { userId, ...profileFields }
        });
    },

    async updateSyncStatus(id, isSyncing, lastSync = null) {
        return prisma.student.update({
            where: { id },
            data: {
                isSyncing,
                ...(lastSync ? { lastSync } : {})
            }
        });
    }
};

const subjectRepository = {
    async findOrCreate(code, name, credits = '3.0', semester = '', branch = '') {
        const cleanCode = code.trim().toUpperCase();
        const cleanName = name ? name.trim() : cleanCode;
        
        return prisma.subject.upsert({
            where: { code: cleanCode },
            update: {
                name: cleanName,
                credits: credits || '3.0',
                semester: semester || '',
                branch: branch || ''
            },
            create: {
                code: cleanCode,
                name: cleanName,
                credits: credits || '3.0',
                semester: semester || '',
                branch: branch || ''
            }
        });
    }
};

const markRepository = {
    async saveMarks(studentId, marksArray) {
        logger.info(`Repository: Saving ${marksArray.length} mark records for student ${studentId}`);

        // Resolve student once outside the transaction (avoids N+1 inside TX)
        const student = await prisma.student.findUnique({ where: { id: studentId } });
        const studentSemester = student ? student.semester : '';
        const studentBranch = student ? student.branch : '';

        // Upsert subjects OUTSIDE the transaction — subjects are global reference
        // data; unique constraint handles concurrent upserts safely.
        const subjectIds = {};
        for (const record of marksArray) {
            const code = record.name.toUpperCase();
            const subject = await prisma.subject.upsert({
                where: { code },
                update: { credits: record.credits || '3.0', semester: studentSemester, branch: studentBranch },
                create: { code, name: record.name, credits: record.credits || '3.0', semester: studentSemester, branch: studentBranch }
            });
            subjectIds[code] = subject.id;
        }

        // Now run a tight transaction that only does delete + inserts (no round trips per row)
        return prisma.$transaction(async (tx) => {
            await tx.markRecord.deleteMany({ where: { studentId } });
            const createdRecords = [];
            for (const record of marksArray) {
                const subjectId = subjectIds[record.name.toUpperCase()];
                if (!subjectId) continue;
                const newMark = await tx.markRecord.create({
                    data: {
                        studentId,
                        subjectId,
                        grade:   record.grade   || 'N/A',
                        credits: record.credits  || '3.0',
                        type:    record.type     || 'Core',
                        status: (record.grade === 'F' || record.grade === 'Backlog') ? 'Backlog' :
                                (record.grade === 'Absent' || record.grade === 'Ab') ? 'Absent' : 'Pass'
                    }
                });
                createdRecords.push(newMark);
            }
            return createdRecords;
        }, { timeout: 120000, maxWait: 60000 });
    }
};

const attendanceRepository = {
    async saveAttendance(studentId, attendanceArray) {
        logger.info(`Repository: Saving ${attendanceArray.length} attendance records for student ${studentId}`);

        // Resolve student once outside the transaction
        const student = await prisma.student.findUnique({ where: { id: studentId } });
        const studentSemester = student ? student.semester : '';
        const studentBranch = student ? student.branch : '';

        // Upsert subjects OUTSIDE the transaction
        const subjectIds = {};
        for (const record of attendanceArray) {
            const code = record.name.toUpperCase();
            const subject = await prisma.subject.upsert({
                where: { code },
                update: { semester: studentSemester, branch: studentBranch },
                create: { code, name: record.name, credits: '3.0', semester: studentSemester, branch: studentBranch }
            });
            subjectIds[code] = subject.id;
        }

        // Tight transaction: only delete + inserts
        return prisma.$transaction(async (tx) => {
            await tx.attendanceRecord.deleteMany({ where: { studentId } });
            const createdRecords = [];
            for (const record of attendanceArray) {
                const subjectId = subjectIds[record.name.toUpperCase()];
                if (!subjectId) continue;
                const held       = record.held || record.total || 0;
                const attended   = record.attended || 0;
                const percentage = held > 0 ? parseFloat(((attended / held) * 100).toFixed(2)) : 0;
                let status = 'Excellent';
                if (percentage < 65) status = 'Warning';
                else if (percentage < 75) status = 'Acceptable';
                else if (percentage < 85) status = 'Good';
                const newAttendance = await tx.attendanceRecord.create({
                    data: { studentId, subjectId, held, attended, percentage, status }
                });
                createdRecords.push(newAttendance);
            }
            return createdRecords;
        }, { timeout: 120000, maxWait: 60000 });
    }
};

const timetableRepository = {
    async saveTimetable(studentId, timetableArray) {
        logger.info(`Repository: Saving ${timetableArray.length} timetable slots for student ${studentId}`);

        const student = await prisma.student.findUnique({ where: { id: studentId } });
        const studentSemester = student ? student.semester : '';
        const studentBranch = student ? student.branch : '';

        // Upsert subjects OUTSIDE the transaction
        const subjectIds = {};
        for (const slot of timetableArray) {
            const code = slot.subjectCode.toUpperCase();
            const subject = await prisma.subject.upsert({
                where: { code },
                update: { name: slot.subjectName, semester: studentSemester, branch: studentBranch },
                create: { code, name: slot.subjectName, credits: '3.0', semester: studentSemester, branch: studentBranch }
            });
            subjectIds[code] = subject.id;
        }

        return prisma.$transaction(async (tx) => {
            await tx.timetableSlot.deleteMany({ where: { studentId } });
            const createdSlots = [];
            for (const slot of timetableArray) {
                const subjectId = subjectIds[slot.subjectCode.toUpperCase()];
                if (!subjectId) continue;
                const newSlot = await tx.timetableSlot.create({
                    data: {
                        studentId,
                        subjectId,
                        day:         slot.day,
                        period:      slot.period.toString(),
                        room:        slot.room        || 'N/A',
                        section:     slot.section     || 'A',
                        facultyName: slot.facultyName || 'TBA',
                        time:        slot.time        || ''
                    }
                });
                createdSlots.push(newSlot);
            }
            return createdSlots;
        }, { timeout: 120000, maxWait: 60000 });
    }
};

const syllabusRepository = {
    async saveSyllabus(subjectCode, unitsArray) {
        logger.info(`Repository: Saving ${unitsArray.length} syllabus units for subject ${subjectCode}`);
        
        return prisma.$transaction(async (tx) => {
            const subject = await tx.subject.findUnique({
                where: { code: subjectCode.toUpperCase() }
            });
            
            if (!subject) {
                logger.warn(`Repository: Cannot sync syllabus for missing subject ${subjectCode}`);
                return [];
            }

            // Clear old syllabus units
            await tx.syllabusUnit.deleteMany({
                where: { subjectId: subject.id }
            });

            const createdUnits = [];
            for (const unit of unitsArray) {
                const newUnit = await tx.syllabusUnit.create({
                    data: {
                        subjectId: subject.id,
                        unitNumber: unit.unitNumber,
                        title: unit.title || `Unit ${unit.unitNumber}`,
                        content: unit.content || '',
                        completed: unit.completed || false
                    }
                });
                createdUnits.push(newUnit);
            }
            return createdUnits;
        });
    },

    async updateUnitCompletion(unitId, completed) {
        return prisma.syllabusUnit.update({
            where: { id: unitId },
            data: { completed }
        });
    }
};

const assignmentRepository = {
    async saveAssignments(studentId, assignmentsArray) {
        logger.info(`Repository: Saving ${assignmentsArray.length} assignments for student ${studentId}`);
        
        return prisma.$transaction(async (tx) => {
            await tx.assignment.deleteMany({
                where: { studentId }
            });

            const createdList = [];
            for (const asn of assignmentsArray) {
                const newAsn = await tx.assignment.create({
                    data: {
                        studentId,
                        title: asn.title,
                        subject: asn.subject || '--',
                        status: asn.status || 'Pending',
                        date: asn.date || '--'
                    }
                });
                createdList.push(newAsn);
            }
            return createdList;
        });
    }
};

const notificationRepository = {
    async saveNotifications(studentId, notificationsArray) {
        const count = await prisma.notification.count({
            where: { studentId }
        });
        if (count > 0) {
            logger.info(`Repository: Notifications already exist for student ${studentId}. Skipping seed.`);
            return [];
        }

        logger.info(`Repository: Seeding ${notificationsArray.length} initial notifications for student ${studentId}`);
        const createdList = [];
        for (const notif of notificationsArray) {
            const newNotif = await prisma.notification.create({
                data: {
                    studentId,
                    title: notif.title,
                    message: notif.message,
                    date: notif.date || new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
                    isRead: notif.isRead || false,
                    type: notif.type || 'general',
                    category: notif.category || 'info'
                }
            });
            createdList.push(newNotif);
        }
        return createdList;
    },

    async appendNotification(studentId, notifData) {
        if (notifData.changeHash) {
            const exists = await prisma.notification.findFirst({
                where: { changeHash: notifData.changeHash }
            });
            if (exists) {
                logger.info(`Repository: Notification with changeHash ${notifData.changeHash} already exists. Skipping.`);
                return exists;
            }
        }

        return prisma.notification.create({
            data: {
                studentId,
                title: notifData.title,
                message: notifData.message,
                type: notifData.type || 'general',
                category: notifData.category || 'info',
                metadata: notifData.metadata || null,
                changeHash: notifData.changeHash || null,
                date: notifData.date || new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
                isRead: false
            }
        });
    },

    async getNotifications(studentId, { page = 1, limit = 20, type, unreadOnly } = {}) {
        const whereClause = { studentId };
        if (type && type !== 'all') {
            whereClause.type = type;
        }
        if (unreadOnly === true || unreadOnly === 'true') {
            whereClause.isRead = false;
        }

        const skip = (page - 1) * limit;

        const [notifications, total] = await prisma.$transaction([
            prisma.notification.findMany({
                where: whereClause,
                orderBy: { createdAt: 'desc' },
                skip,
                take: limit
            }),
            prisma.notification.count({ where: whereClause })
        ]);

        return {
            notifications,
            total,
            page,
            totalPages: Math.ceil(total / limit)
        };
    },

    async getUnreadCount(studentId) {
        return prisma.notification.count({
            where: {
                studentId,
                isRead: false
            }
        });
    },

    async markRead(studentId, notificationId) {
        return prisma.notification.updateMany({
            where: {
                id: notificationId,
                studentId
            },
            data: { isRead: true }
        });
    },

    async markAllRead(studentId) {
        return prisma.notification.updateMany({
            where: {
                studentId,
                isRead: false
            },
            data: { isRead: true }
        });
    },

    async deleteNotification(studentId, notificationId) {
        return prisma.notification.deleteMany({
            where: {
                id: notificationId,
                studentId
            }
        });
    },

    async saveChangeEvent(data) {
        return prisma.notificationEvent.upsert({
            where: { changeHash: data.changeHash },
            update: {},
            create: {
                studentId: data.studentId,
                eventType: data.eventType,
                changeHash: data.changeHash,
                oldValue: data.oldValue || null,
                newValue: data.newValue || null,
                metadata: data.metadata || null,
                notified: data.notified || false
            }
        });
    },

    async hasChangeEvent(changeHash) {
        const count = await prisma.notificationEvent.count({
            where: { changeHash }
        });
        return count > 0;
    }
};

const auditLogRepository = {
    async log(studentId, action, details, adminId = null, severity = 'INFO') {
        logger.debug(`AuditLog: [${action}] Student: ${studentId || 'None'} | Admin: ${adminId || 'None'} | Severity: ${severity} - ${details}`);
        try {
            return await prisma.auditLog.create({
                data: {
                    student: studentId ? { connect: { id: studentId } } : undefined,
                    admin: adminId ? { connect: { id: adminId } } : undefined,
                    action,
                    details,
                    severity
                }
            });
        } catch (e) {
            logger.warn(`AuditLog insertion failed (non-blocking): ${e.message}`);
            return null;
        }
    }
};

const feeRepository = {
    async saveFees(studentId, semester, feesData) {
        logger.info(`Repository: Saving fees for student ${studentId}, semester ${semester}`);
        
        return prisma.$transaction(async (tx) => {
            // Delete old fee records for this student and semester
            await tx.fee.deleteMany({
                where: { studentId, semester }
            });

            const createdFees = [];
            if (feesData && feesData.transactions) {
                for (const line of feesData.transactions) {
                    const amount = parseFloat(line.amount.replace(/[^\d.]/g, '')) || 0;
                    const paidAmount = parseFloat(line.paid.replace(/[^\d.]/g, '')) || 0;
                    const dueAmount = parseFloat(line.due.replace(/[^\d.]/g, '')) || 0;
                    
                    const newFee = await tx.fee.create({
                        data: {
                            studentId,
                            semester,
                            feeType: line.title,
                            amount,
                            paidAmount,
                            dueAmount,
                            dueDate: line.date || '--',
                            paymentStatus: line.status || (dueAmount > 0 ? 'Due' : 'Paid')
                        }
                    });
                    createdFees.push(newFee);
                }
            }
            return createdFees;
        });
    },

    async getFeesForStudent(studentId) {
        return prisma.fee.findMany({
            where: { studentId }
        });
    }
};

module.exports = {
    studentRepository,
    subjectRepository,
    markRepository,
    attendanceRepository,
    timetableRepository,
    syllabusRepository,
    assignmentRepository,
    notificationRepository,
    auditLogRepository,
    feeRepository
};
