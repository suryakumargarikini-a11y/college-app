'use strict';
const prisma = require('./dbService');
const logger = require('./logger');

const HOSTEL_WARDEN_BASIC_FIELDS = Object.freeze([
    'id',
    'name',
    'roll',
    'branch',
    'year',
    'semester',
    'section',
    'hostel',
    'roomNo',
    'gender',
    'photoUrl'
]);

/**
 * Checks if a student is a hostel resident.
 */
function isHostelResident(student) {
    if (!student || !student.hostel) return false;
    const clean = student.hostel.trim().toLowerCase();
    return clean !== '' && clean !== 'no' && clean !== 'none' && clean !== 'day scholar';
}

/**
 * Strips all sensitive fields from a student record, returning ONLY the basic fields allowed for Hostel Warden.
 */
function sanitizeStudentForWarden(student) {
    if (!student) return null;
    const sanitized = {};
    for (const field of HOSTEL_WARDEN_BASIC_FIELDS) {
        sanitized[field] = student[field] !== undefined ? student[field] : null;
    }
    if (!sanitized.photoUrl) {
        sanitized.photoUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(student.name || 'Student')}&background=3b82f6&color=fff&size=64`;
    }
    return sanitized;
}

/**
 * Ensures Hostel Warden is restricted to READ-ONLY operations.
 * Throws 403 error for forbidden actions (APPROVE, REJECT, GATE_VERIFY, MODIFY).
 */
function assertWardenReadOnly(action) {
    const forbidden = ['APPROVE', 'REJECT', 'GATE_VERIFY', 'MODIFY', 'UPDATE', 'DELETE', 'CREATE'];
    if (action && forbidden.includes(action.toUpperCase())) {
        const error = new Error(`Forbidden: Hostel Warden has read-only access and cannot execute '${action}'`);
        error.status = 403;
        throw error;
    }
}

/**
 * Retrieves a list of hostel resident students for Hostel Warden, returning sanitized basic profiles.
 */
async function getHostelStudentsForWarden(admin, queryParams = {}) {
    if (!admin || admin.role !== 'HOSTEL_WARDEN') {
        const error = new Error('Forbidden: Access restricted to Hostel Warden');
        error.status = 403;
        throw error;
    }

    const { search, branch, year, hostel } = queryParams;

    const where = {
        hostel: {
            notIn: ['', 'no', 'NO', 'No', 'none', 'NONE', 'day scholar', 'Day Scholar']
        }
    };

    if (branch) where.branch = branch;
    if (year)   where.year   = year;
    if (hostel) where.hostel = { contains: hostel, mode: 'insensitive' };

    const students = await prisma.student.findMany({
        where,
        select: {
            id: true, name: true, roll: true, branch: true, year: true,
            semester: true, section: true, hostel: true, roomNo: true,
            gender: true, photoUrl: true
        }
    });

    let filtered = students;
    if (search) {
        const term = search.toLowerCase();
        filtered = students.filter(s =>
            (s.name || '').toLowerCase().includes(term) ||
            (s.roll || '').toLowerCase().includes(term) ||
            (s.roomNo || '').toLowerCase().includes(term)
        );
    }

    return filtered.map(s => sanitizeStudentForWarden(s));
}

/**
 * Retrieves a single student profile for Hostel Warden.
 * Enforces:
 * 1. Target student MUST be a hostel resident (returns 403 if non-hostel student).
 * 2. Returns ONLY sanitized basic fields (phone, email, fees, marks, credentials omitted).
 */
async function getHostelStudentProfileForWarden(admin, studentIdOrRoll) {
    if (!admin || admin.role !== 'HOSTEL_WARDEN') {
        const error = new Error('Forbidden: Access restricted to Hostel Warden');
        error.status = 403;
        throw error;
    }

    const student = await prisma.student.findFirst({
        where: { OR: [{ id: studentIdOrRoll }, { roll: studentIdOrRoll }] }
    });

    if (!student) {
        const error = new Error('Student not found');
        error.status = 404;
        throw error;
    }

    if (!isHostelResident(student)) {
        const error = new Error(`Forbidden: Hostel Warden may only view hostel resident profiles. Student '${student.roll}' is a non-hostel student.`);
        error.status = 403;
        throw error;
    }

    return sanitizeStudentForWarden(student);
}

/**
 * Asserts that a Hostel Warden is authorized to manage (approve/reject) a specific exit pass.
 * Verification Rules:
 * 1. Target admin must be Hostel Warden.
 * 2. Target pass and student must exist.
 * 3. Student MUST qualify as a hostel resident according to isHostelResident(student).
 * Throws 403 error if student is a day scholar or non-hostel resident.
 */
function assertWardenCanManageExitPass(admin, pass) {
    if (!admin || admin.role !== 'HOSTEL_WARDEN') {
        const error = new Error('Forbidden: Access restricted to Hostel Warden');
        error.status = 403;
        throw error;
    }
    if (!pass) {
        const error = new Error('Exit pass not found');
        error.status = 404;
        throw error;
    }
    const student = pass.student;
    if (!isHostelResident(student)) {
        const error = new Error(`Forbidden: Hostel Warden may only manage exit passes for hostel residents. Student '${student?.roll || pass.studentId}' is a day scholar.`);
        error.status = 403;
        throw error;
    }
    return true;
}

/**
 * Retrieves exit pass records for hostel students accessible to Hostel Warden with server-side pagination & status filtering.
 */
async function getHostelExitPassesForWarden(admin, queryParams = {}) {
    if (!admin || admin.role !== 'HOSTEL_WARDEN') {
        const error = new Error('Forbidden: Access restricted to Hostel Warden');
        error.status = 403;
        throw error;
    }

    const { page = 1, limit = 25, status, search } = queryParams;
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.max(1, Math.min(100, parseInt(limit) || 25));
    const skip = (pageNum - 1) * limitNum;

    const where = {
        student: {
            hostel: {
                notIn: ['', 'no', 'NO', 'No', 'none', 'NONE', 'day scholar', 'Day Scholar']
            }
        }
    };

    if (status && status !== 'ALL') {
        where.status = status;
    }

    if (search) {
        const cleanSearch = search.trim();
        where.OR = [
            { student: { name: { contains: cleanSearch, mode: 'insensitive' } } },
            { student: { roll: { contains: cleanSearch, mode: 'insensitive' } } },
            { destination: { contains: cleanSearch, mode: 'insensitive' } }
        ];
    }

    const total = await prisma.exitPass.count({ where });
    const passes = await prisma.exitPass.findMany({
        where,
        include: {
            student: {
                select: {
                    id: true, name: true, roll: true, branch: true,
                    year: true, section: true, hostel: true, roomNo: true, photoUrl: true
                }
            },
            groupRequest: true
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limitNum
    });

    // Sanitise sensitive token hashes from output
    const sanitized = passes.map(p => {
        const { qrCode, qrTokenHash, otpHash, ...rest } = p;
        return rest;
    });

    return {
        passes: sanitized,
        pagination: {
            page: pageNum,
            limit: limitNum,
            total,
            totalPages: Math.ceil(total / limitNum) || 1
        }
    };
}

module.exports = {
    HOSTEL_WARDEN_BASIC_FIELDS,
    isHostelResident,
    sanitizeStudentForWarden,
    assertWardenReadOnly,
    assertWardenCanManageExitPass,
    getHostelStudentsForWarden,
    getHostelStudentProfileForWarden,
    getHostelExitPassesForWarden
};