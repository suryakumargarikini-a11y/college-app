'use strict';

const { studentRepository } = require('../repositories');
const prisma = require('../services/dbService');

class ProductionProvider {
    async getProfile(userId) {
        let student = null;
        try {
            student = await studentRepository.findByUserId(userId);
        } catch (_) {}

        if (!student) {
            student = await prisma.student.findUnique({ where: { userId } }).catch(() => null);
        }

        if (!student) {
            return {
                userId,
                name: userId,
                branch: '',
                section: '',
                semester: '',
                year: ''
            };
        }
        return student;
    }

    async getMarks(userId) {
        let student = null;
        try {
            student = await studentRepository.findByUserId(userId);
        } catch (e) {
            logger.warn(`[ProductionProvider] DB lookup note: ${e.message}`);
        }

        if (!student) {
            student = {
                userId,
                name: userId,
                cgpa: '--',
                percentage: '--',
                marks: []
            };
        }
        const markRepository = require('../repositories').markRepository || require('../repositories');
        const academicResults = await markRepository.getAcademicResults(userId);

        if (academicResults) {
            student.semesters = academicResults.semesters || [];
            student.overall = academicResults.overall || null;
            if (academicResults.overall && academicResults.overall.cgpa) {
                student.cgpa = academicResults.overall.cgpa;
            }
        } else {
            student.semesters = [];
            student.overall = null;
        }
        return student;
    }

    async getAttendance(userId) {
        const student = await prisma.student.findUnique({
            where: { userId },
            select: { id: true }
        });
        if (!student) {
            return [];
        }
        const records = await prisma.attendanceRecord.findMany({
            where: { studentId: student.id },
            include: {
                subject: {
                    select: {
                        code: true
                    }
                }
            }
        });
        return records || [];
    }

    async getFees(userId) {
        const student = await studentRepository.findByUserId(userId);
        if (!student) {
            return null;
        }
        const feesList = await prisma.fee.findMany({
            where: { studentId: student.id }
        });
        return feesList;
    }

    async getAssignments(userId) {
        const student = await studentRepository.findByUserId(userId);
        if (!student) {
            return [];
        }
        return student.assignments || [];
    }

    async getTimetable(userId) {
        const student = await studentRepository.findByUserId(userId);
        if (!student) {
            return [];
        }
        return student.timetable || [];
    }

    async getSyllabus(userId) {
        const student = await studentRepository.findByUserId(userId);
        if (!student || !student.marks) {
            return [];
        }
        const subjectIds = [
            ...new Set([
                ...(student.marks || []).map(m => m.subjectId),
                ...(student.attendance || []).map(a => a.subjectId)
            ])
        ].filter(Boolean);
        if (subjectIds.length === 0) return [];
        const subjectsWithSyllabus = await prisma.subject.findMany({
            where: { id: { in: subjectIds } },
            include: { syllabus: true }
        });
        return subjectsWithSyllabus;
    }

    async getNotifications(userId, page, limit, type) {
        const student = await studentRepository.findByUserId(userId);
        if (!student) {
            return { notifications: [], total: 0, page, totalPages: 0 };
        }
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

    async getLmsCourses(userId) {
        if (typeof prisma.courseEnrollment === 'undefined' || typeof prisma.certificate === 'undefined') {
            return { courses: [], certificates: [] };
        }
        const student = await prisma.student.findUnique({
            where: { userId },
            select: { id: true }
        });
        if (!student) return { courses: [], certificates: [] };

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
}

module.exports = new ProductionProvider();
