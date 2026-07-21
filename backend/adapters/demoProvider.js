'use strict';

const prisma = require('../services/dbService');
const logger = require('../services/logger');

class DemoProvider {
    async getProfile(userId) {
        try {
            const student = await prisma.student.findUnique({
                where: { userId },
                include: {
                    marks: { include: { subject: true } },
                    attendance: { include: { subject: true } },
                    timetable: { include: { subject: true } },
                    assignments: true,
                    fees: true
                }
            });
            if (student) return student;
        } catch (e) {
            logger.error(`[DemoProvider] DB lookup failed: ${e.message}`);
        }

        // Resilient Fallback to avoid breaking demo
        logger.warn(`[DemoProvider] Student ${userId} not found in DB. Returning mock fallback.`);
        return this._getMockFallbackStudent(userId);
    }

    async getMarks(userId) {
        try {
            const student = await prisma.student.findUnique({
                where: { userId },
                include: {
                    marks: { include: { subject: true } }
                }
            });
            if (student && student.marks.length > 0) return student;
        } catch (e) {
            logger.error(`[DemoProvider] Marks lookup failed: ${e.message}`);
        }

        // Mock marks fallback
        return {
            cgpa: '8.85',
            percentage: '88.50%',
            marks: [
                { subject: { code: 'CS-401', name: 'Data Structures & Algorithms' }, grade: 'A+', credits: '4', type: 'Core' },
                { subject: { code: 'CS-402', name: 'Operating Systems' }, grade: 'A', credits: '4', type: 'Core' },
                { subject: { code: 'CS-403', name: 'Computer Networks' }, grade: 'B+', credits: '3', type: 'Core' },
                { subject: { code: 'CS-404', name: 'Database Management Systems' }, grade: 'A', credits: '4', type: 'Core' }
            ]
        };
    }

    async getAttendance(userId) {
        try {
            const student = await prisma.student.findUnique({
                where: { userId },
                select: { id: true }
            });
            if (student) {
                const records = await prisma.attendanceRecord.findMany({
                    where: { studentId: student.id },
                    include: { subject: { select: { code: true } } }
                });
                if (records.length > 0) return records;
            }
        } catch (e) {
            logger.error(`[DemoProvider] Attendance lookup failed: ${e.message}`);
        }

        // Fallback attendance
        return [
            { subject: { code: 'CS-401' }, held: 40, attended: 36, percentage: 90.0, status: 'Excellent' },
            { subject: { code: 'CS-402' }, held: 38, attended: 30, percentage: 78.9, status: 'Safe' },
            { subject: { code: 'CS-403' }, held: 35, attended: 32, percentage: 91.4, status: 'Excellent' },
            { subject: { code: 'CS-404' }, held: 30, attended: 21, percentage: 70.0, status: 'Warning' }
        ];
    }

    async getFees(userId) {
        try {
            const student = await prisma.student.findUnique({
                where: { userId },
                select: { id: true }
            });
            if (student) {
                const feesList = await prisma.fee.findMany({
                    where: { studentId: student.id }
                });
                if (feesList.length > 0) return feesList;
            }
        } catch (e) {
            logger.error(`[DemoProvider] Fees lookup failed: ${e.message}`);
        }

        // Fallback fees
        return [
            { feeType: 'Tuition Fee', amount: 85000, paidAmount: 85000, dueAmount: 0, dueDate: '--', paymentStatus: 'Paid', id: 'fee-1' },
            { feeType: 'Hostel Fee', amount: 45000, paidAmount: 45000, dueAmount: 0, dueDate: '--', paymentStatus: 'Paid', id: 'fee-2' },
            { feeType: 'Development Fee', amount: 15000, paidAmount: 0, dueAmount: 15000, dueDate: 'May 31, 2026', paymentStatus: 'Due', id: 'fee-3' }
        ];
    }

    async getAssignments(userId) {
        try {
            const student = await prisma.student.findUnique({
                where: { userId },
                select: { assignments: true }
            });
            if (student && student.assignments.length > 0) return student.assignments;
        } catch (e) {
            logger.error(`[DemoProvider] Assignments lookup failed: ${e.message}`);
        }

        return [
            { title: 'B-Tree Implementation', subject: 'CS-401', status: 'Submitted', date: 'May 10, 2026' },
            { title: 'Process Scheduling Simulation', subject: 'CS-402', status: 'Pending', date: 'June 5, 2026' },
            { title: 'ER Diagram Design', subject: 'CS-403', status: 'Urgent', date: 'June 3, 2026' }
        ];
    }

    async getTimetable(userId) {
        try {
            const student = await prisma.student.findUnique({
                where: { userId },
                include: {
                    timetable: { include: { subject: true } }
                }
            });
            if (student && student.timetable.length > 0) return student.timetable;
        } catch (e) {
            logger.error(`[DemoProvider] Timetable lookup failed: ${e.message}`);
        }

        // Timetable fallback
        return [];
    }

    async getSyllabus(userId) {
        try {
            const student = await prisma.student.findUnique({
                where: { userId },
                include: {
                    marks: true,
                    attendance: true
                }
            });
            if (student) {
                const subjectIds = [
                    ...new Set([
                        ...student.marks.map(m => m.subjectId),
                        ...student.attendance.map(a => a.subjectId)
                    ])
                ];
                const subjectsWithSyllabus = await prisma.subject.findMany({
                    where: { id: { in: subjectIds } },
                    include: { syllabus: true }
                });
                if (subjectsWithSyllabus.length > 0) return subjectsWithSyllabus;
            }
        } catch (e) {
            logger.error(`[DemoProvider] Syllabus lookup failed: ${e.message}`);
        }

        return [];
    }

    async getNotifications(userId, page, limit, type) {
        try {
            const student = await prisma.student.findUnique({
                where: { userId },
                select: { id: true }
            });
            if (student) {
                const where = { studentId: student.id };
                if (type && type !== 'all') {
                    where.type = type;
                }
                const skip = (page - 1) * limit;
                const [notifications, total] = await Promise.all([
                    prisma.notification.findMany({
                        where,
                        orderBy: { createdAt: 'desc' },
                        skip,
                        take: limit
                    }),
                    prisma.notification.count({ where })
                ]);
                return {
                    notifications,
                    total,
                    page,
                    totalPages: Math.ceil(total / limit)
                };
            }
        } catch (e) {
            logger.error(`[DemoProvider] Notifications lookup failed: ${e.message}`);
        }

        return { notifications: [], total: 0, page, totalPages: 0 };
    }

    async getLmsCourses(userId) {
        if (typeof prisma.courseEnrollment === 'undefined' || typeof prisma.certificate === 'undefined') {
            return { courses: [], certificates: [] };
        }
        try {
            const student = await prisma.student.findUnique({
                where: { userId },
                select: { id: true }
            });
            if (student) {
                const [enrollments, certificates] = await Promise.all([
                    prisma.courseEnrollment.findMany({
                        where: { studentId: student.id },
                        include: {
                            course: {
                                include: {
                                    faculty: true,
                                    assignments: {
                                        include: {
                                            submissions: { where: { studentId: student.id } }
                                        }
                                    },
                                    quizzes: {
                                        include: {
                                            results: { where: { studentId: student.id } }
                                        }
                                    },
                                    progress: { where: { studentId: student.id } }
                                }
                            }
                        }
                    }),
                    prisma.certificate.findMany({
                        where: { studentId: student.id },
                        include: { course: true }
                    })
                ]);
                return {
                    courses: enrollments.map(e => e.course),
                    certificates
                };
            }
        } catch (e) {
            logger.error(`[DemoProvider] LMS Courses lookup failed: ${e.message}`);
        }
        return { courses: [], certificates: [] };
    }

    _getMockFallbackStudent(userId) {
        return {
            id: 'mock-id-' + userId,
            userId,
            name: 'Demo Student A',
            roll: userId,
            program: 'B.Tech',
            branch: 'Computer Science & Engineering',
            semester: 'IV/IV B.Tech II Semester',
            section: 'A',
            year: '4',
            gender: 'Male',
            dob: '2004-05-15',
            email: userId + '@sitamecap.co.in',
            phone: '9876543210',
            fatherName: 'Father Name',
            motherName: 'Mother Name',
            fatherMobile: '9876543211',
            hostel: 'Yes',
            roomNo: 'A-204',
            cgpa: '8.85',
            percentage: '88.50%',
            address: 'Visakhapatnam, Andhra Pradesh',
            admissionNo: 'ADM20224532',
            joiningDate: '2022-08-20',
            caste: 'General',
            nationality: 'Indian',
            religion: 'Hindu',
            sscMarks: '9.8 GPA',
            interMarks: '978/1000',
            scholarship: 'None',
            seatType: 'Convenor',
            entranceType: 'EAPCET',
            entranceRank: '4532',
            aadhar: '1234 5678 9012',
            photoUrl: '',
            guardianName: 'Father Name',
            guardianPhone: '9876543211',
            guardianAddress: 'Visakhapatnam, Andhra Pradesh',
            marks: [],
            attendance: [],
            timetable: [],
            assignments: [],
            fees: []
        };
    }
}

module.exports = new DemoProvider();
