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
        
        return prisma.student.upsert({
            where: { userId },
            update: {
                password: encryptedPassword,
                name: data.name,
                roll: data.roll,
                roll_number: rollNum,
                section: sec,
                program: data.program,
                branch: data.branch,
                semester: data.semester,
                year: data.year,
                gender: data.gender,
                dob: data.dob,
                email: data.email,
                phone: data.phone,
                fatherName: data.fatherName,
                motherName: data.motherName,
                fatherMobile: data.fatherMobile,
                hostel: data.hostel,
                roomNo: data.roomNo,
                cgpa: data.cgpa,
                percentage: data.percentage,
                address: data.address,
                bloodGroup: data.bloodGroup || '',
                emergencyContact: data.emergencyContact || '',
                admissionNo: data.admissionNo || '',
                joiningDate: data.joiningDate || '',
                caste: data.caste || '',
                nationality: data.nationality || '',
                religion: data.religion || '',
                sscMarks: data.sscMarks || '',
                interMarks: data.interMarks || '',
                scholarship: data.scholarship || '',
                seatType: data.seatType || '',
                entranceType: data.entranceType || '',
                entranceRank: data.entranceRank || '',
                aadhar: data.aadhar || '',
                photoUrl: data.photoUrl || '',
                guardianName: data.guardianName || '',
                guardianPhone: data.guardianPhone || '',
                guardianAddress: data.guardianAddress || ''
            },
            create: {
                userId,
                password: encryptedPassword,
                name: data.name,
                roll: data.roll,
                roll_number: rollNum,
                section: sec,
                program: data.program,
                branch: data.branch,
                semester: data.semester,
                year: data.year,
                gender: data.gender,
                dob: data.dob,
                email: data.email,
                phone: data.phone,
                fatherName: data.fatherName,
                motherName: data.motherName,
                fatherMobile: data.fatherMobile,
                hostel: data.hostel,
                roomNo: data.roomNo,
                cgpa: data.cgpa,
                percentage: data.percentage,
                address: data.address,
                bloodGroup: data.bloodGroup || '',
                emergencyContact: data.emergencyContact || '',
                admissionNo: data.admissionNo || '',
                joiningDate: data.joiningDate || '',
                caste: data.caste || '',
                nationality: data.nationality || '',
                religion: data.religion || '',
                sscMarks: data.sscMarks || '',
                interMarks: data.interMarks || '',
                scholarship: data.scholarship || '',
                seatType: data.seatType || '',
                entranceType: data.entranceType || '',
                entranceRank: data.entranceRank || '',
                aadhar: data.aadhar || '',
                photoUrl: data.photoUrl || '',
                guardianName: data.guardianName || '',
                guardianPhone: data.guardianPhone || '',
                guardianAddress: data.guardianAddress || ''
            }
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
        
        return prisma.$transaction(async (tx) => {
            // Find student to get semester and branch details
            const student = await tx.student.findUnique({
                where: { id: studentId }
            });
            const studentSemester = student ? student.semester : '';
            const studentBranch = student ? student.branch : '';

            // Delete old mark records for this student first to avoid duplicates
            await tx.markRecord.deleteMany({
                where: { studentId }
            });

            const createdRecords = [];
            for (const record of marksArray) {
                // Find or create subject
                const subject = await tx.subject.upsert({
                    where: { code: record.name.toUpperCase() },
                    update: {
                        credits: record.credits || '3.0',
                        semester: studentSemester,
                        branch: studentBranch
                    },
                    create: {
                        code: record.name.toUpperCase(),
                        name: record.name,
                        credits: record.credits || '3.0',
                        semester: studentSemester,
                        branch: studentBranch
                    }
                });

                // Insert new MarkRecord
                const newMark = await tx.markRecord.create({
                    data: {
                        studentId,
                        subjectId: subject.id,
                        grade: record.grade || 'N/A',
                        credits: record.credits || '3.0',
                        type: record.type || 'Core',
                        status: (record.grade === 'F' || record.grade === 'Backlog') ? 'Backlog' :
                                (record.grade === 'Absent' || record.grade === 'Ab') ? 'Absent' : 'Pass'
                    }
                });
                createdRecords.push(newMark);
            }
            return createdRecords;
        });
    }
};

const attendanceRepository = {
    async saveAttendance(studentId, attendanceArray) {
        logger.info(`Repository: Saving ${attendanceArray.length} attendance records for student ${studentId}`);
        
        return prisma.$transaction(async (tx) => {
            // Find student to get semester and branch details
            const student = await tx.student.findUnique({
                where: { id: studentId }
            });
            const studentSemester = student ? student.semester : '';
            const studentBranch = student ? student.branch : '';

            // Clear previous attendance records
            await tx.attendanceRecord.deleteMany({
                where: { studentId }
            });

            const createdRecords = [];
            for (const record of attendanceArray) {
                const subjectCode = record.name.toUpperCase();
                
                // Find or create subject
                const subject = await tx.subject.upsert({
                    where: { code: subjectCode },
                    update: {
                        semester: studentSemester,
                        branch: studentBranch
                    },
                    create: {
                        code: subjectCode,
                        name: record.name,
                        credits: '3.0',
                        semester: studentSemester,
                        branch: studentBranch
                    }
                });

                // Calculate percentage strictly: Present / Total * 100
                const held = record.held || record.total || 0;
                const attended = record.attended || 0;
                const percentage = held > 0 ? parseFloat(((attended / held) * 100).toFixed(2)) : 0;
                
                let status = 'Excellent';
                if (percentage < 65) status = 'Warning';
                else if (percentage < 75) status = 'Acceptable';
                else if (percentage < 85) status = 'Good';

                const newAttendance = await tx.attendanceRecord.create({
                    data: {
                        studentId,
                        subjectId: subject.id,
                        held,
                        attended,
                        percentage,
                        status
                    }
                });
                createdRecords.push(newAttendance);
            }
            return createdRecords;
        });
    }
};

const timetableRepository = {
    async saveTimetable(studentId, timetableArray) {
        logger.info(`Repository: Saving ${timetableArray.length} timetable slots for student ${studentId}`);
        
        return prisma.$transaction(async (tx) => {
            // Find student to get semester and branch details
            const student = await tx.student.findUnique({
                where: { id: studentId }
            });
            const studentSemester = student ? student.semester : '';
            const studentBranch = student ? student.branch : '';

            // Delete old timetable slots
            await tx.timetableSlot.deleteMany({
                where: { studentId }
            });

            const createdSlots = [];
            for (const slot of timetableArray) {
                const subjectCode = slot.subjectCode.toUpperCase();
                
                // Find or create subject
                const subject = await tx.subject.upsert({
                    where: { code: subjectCode },
                    update: { 
                        name: slot.subjectName,
                        semester: studentSemester,
                        branch: studentBranch
                    },
                    create: {
                        code: subjectCode,
                        name: slot.subjectName,
                        credits: '3.0',
                        semester: studentSemester,
                        branch: studentBranch
                    }
                });

                const newSlot = await tx.timetableSlot.create({
                    data: {
                        studentId,
                        subjectId: subject.id,
                        day: slot.day,
                        period: slot.period.toString(),
                        room: slot.room || 'N/A',
                        section: slot.section || 'A',
                        facultyName: slot.facultyName || 'TBA',
                        time: slot.time || ''
                    }
                });
                createdSlots.push(newSlot);
            }
            return createdSlots;
        });
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
        return prisma.auditLog.create({
            data: {
                student: studentId ? { connect: { id: studentId } } : undefined,
                admin: adminId ? { connect: { id: adminId } } : undefined,
                action,
                details,
                severity
            }
        });
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
