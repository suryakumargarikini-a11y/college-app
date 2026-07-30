'use strict';
const prisma = require('../services/dbService');
const logger = require('../services/logger');
const staffScopeService = require('../services/staffScopeService');
const libraryStorage = require('../services/libraryStorage');

// Helper to determine assignment deadline status for a student
function deriveAssignmentStatus(assignment, submission) {
    if (submission) {
        if (submission.marks !== null && submission.marks !== undefined) {
            return 'GRADED';
        }
        return submission.status === 'LATE' ? 'LATE' : 'SUBMITTED';
    }
    const now = new Date();
    const due = new Date(assignment.dueDate);
    if (now > due) {
        return 'OVERDUE';
    }
    return 'NOT_SUBMITTED';
}

// Helper to check if student is eligible for an assignment or study material target scope
function isStudentEligible(student, targetBranch, targetYear, targetSemester, targetSection) {
    if (!student) return false;
    
    // 1. Branch match
    if (!targetBranch || targetBranch === 'ALL' || !targetBranch.trim()) return false;
    const studentCanon = staffScopeService.canonicalizeBranch(student.branch);
    const targetCanon = staffScopeService.canonicalizeBranch(targetBranch);
    if (studentCanon !== targetCanon) return false;

    // 2. Year match
    if (!targetYear || targetYear === 'ALL' || !targetYear.trim()) return false;
    const normStudentYear = String(student.year || '').replace(/[^0-9]/g, '');
    const normTargetYear = String(targetYear || '').replace(/[^0-9]/g, '');
    if (normStudentYear && normTargetYear) {
        if (normStudentYear !== normTargetYear) return false;
    } else if (String(student.year).trim() !== String(targetYear).trim()) {
        return false;
    }

    // 3. Semester match
    if (!targetSemester || targetSemester === 'ALL' || !targetSemester.trim()) return false;
    const normStudentSem = String(student.semester || '').replace(/[^0-9]/g, '');
    const normTargetSem = String(targetSemester || '').replace(/[^0-9]/g, '');
    if (normStudentSem && normTargetSem) {
        if (normStudentSem !== normTargetSem) return false;
    } else if (String(student.semester).trim() !== String(targetSemester).trim()) {
        return false;
    }

    // 4. Section match
    if (!targetSection || targetSection === 'ALL' || !targetSection.trim()) return false;
    const normStudentSec = String(student.section || '').trim().toUpperCase();
    const normTargetSec = String(targetSection || '').trim().toUpperCase();
    if (normStudentSec !== normTargetSec) {
        return false;
    }

    return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN / FACULTY / STAFF LMS CONTROLLERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/admin/lms/courses
 * List subjects/courses filtered by staff department scope.
 */
const getAdminCourses = async (req, res, next) => {
    try {
        const admin = req.admin;
        const role = admin.role;
        
        if (['HOSTEL_WARDEN', 'SECURITY_GUARD', 'ACCOUNTS_ADMIN', 'PLACEMENT_ADMIN'].includes(role)) {
            return res.status(403).json({ error: 'LMS management access denied for your role' });
        }
        
        const { canonicals, rawAliases } = await staffScopeService.getAuthorizedDepartments(admin);
        let subjectWhere = {};
        if (role === 'HOD' || role === 'FACULTY') {
            if (rawAliases.length > 0) {
                subjectWhere = { branch: { in: rawAliases } };
            }
        }
        
        const subjects = await prisma.subject.findMany({
            where: subjectWhere,
            select: {
                id: true,
                code: true,
                name: true,
                credits: true,
                semester: true,
                branch: true,
                _count: {
                    select: {
                        studyMaterials: true,
                        lmsAssignments: true
                    }
                }
            },
            orderBy: { code: 'asc' }
        });
        
        res.json({ success: true, courses: subjects });
    } catch (err) {
        logger.error('[LMS] getAdminCourses error:', err);
        next(err);
    }
};

/**
 * GET /api/admin/lms/materials
 * List study materials within staff scope.
 */
const getAdminMaterials = async (req, res, next) => {
    try {
        const admin = req.admin;
        const role = admin.role;
        
        if (['HOSTEL_WARDEN', 'SECURITY_GUARD', 'ACCOUNTS_ADMIN', 'PLACEMENT_ADMIN'].includes(role)) {
            return res.status(403).json({ error: 'LMS management access denied for your role' });
        }
        
        const { rawAliases } = await staffScopeService.getAuthorizedDepartments(admin);
        let whereClause = {};
        if ((role === 'HOD' || role === 'FACULTY') && rawAliases.length > 0) {
            whereClause = {
                OR: [
                    { branch: { in: rawAliases } },
                    { branch: 'ALL' },
                    { branch: '' },
                    { uploadedByAdminId: admin.id }
                ]
            };
        }
        
        const materials = await prisma.studyMaterial.findMany({
            where: whereClause,
            include: {
                subject: { select: { id: true, code: true, name: true } },
                uploadedByAdmin: { select: { id: true, name: true, role: true } }
            },
            orderBy: { createdAt: 'desc' }
        });
        
        res.json({ success: true, materials });
    } catch (err) {
        logger.error('[LMS] getAdminMaterials error:', err);
        next(err);
    }
};

/**
 * POST /api/admin/lms/materials
 * Create a new study material.
 */
const createStudyMaterial = async (req, res, next) => {
    try {
        const admin = req.admin;
        const role = admin.role;
        
        if (!['SUPER_ADMIN', 'HOD', 'FACULTY'].includes(role)) {
            return res.status(403).json({ error: 'Only Super Admin, HOD, and Faculty can publish study materials' });
        }
        
        const { title, description, category, subjectId, branch, year, semester, section, fileUrl, fileName } = req.body;
        
        if (!title || !title.trim()) {
            return res.status(400).json({ error: 'Title is required' });
        }
        if (!branch || !branch.trim() || branch === 'ALL') {
            return res.status(400).json({ error: 'Target Branch is required' });
        }
        if (!year || !year.trim() || year === 'ALL') {
            return res.status(400).json({ error: 'Target Year is required' });
        }
        if (!semester || !semester.trim() || semester === 'ALL') {
            return res.status(400).json({ error: 'Target Semester is required' });
        }
        if (!section || !section.trim() || section === 'ALL') {
            return res.status(400).json({ error: 'Target Section is required' });
        }
        
        // Scope Validation for HOD/Faculty
        if (role === 'HOD' || role === 'FACULTY') {
            const { canonicals } = await staffScopeService.getAuthorizedDepartments(admin);
            if (!staffScopeService.canAccessBranchWithScopes(canonicals, branch)) {
                return res.status(403).json({ error: 'Cannot create study material for unauthorized department' });
            }
        }
        
        const material = await prisma.studyMaterial.create({
            data: {
                title: title.trim(),
                description: description ? description.trim() : null,
                category: category || 'LECTURE_NOTE',
                subjectId: subjectId || null,
                fileUrl: fileUrl || null,
                fileName: fileName || null,
                uploadedByAdminId: admin.id,
                uploadedByName: admin.name,
                uploadedByRole: admin.role,
                branch: branch || 'ALL',
                year: year || 'ALL',
                semester: semester || 'ALL',
                section: section || 'ALL'
            },
            include: {
                subject: { select: { id: true, code: true, name: true } }
            }
        });
        
        // Notify eligible students
        try {
            let studentWhere = {};
            if (material.branch && material.branch !== 'ALL') {
                const aliases = staffScopeService.getRawAliasesForCanonicals([staffScopeService.canonicalizeBranch(material.branch)]);
                studentWhere.branch = { in: aliases };
            }
            if (material.year && material.year !== 'ALL') studentWhere.year = material.year;
            if (material.semester && material.semester !== 'ALL') studentWhere.semester = material.semester;
            
            const targetStudents = await prisma.student.findMany({
                where: studentWhere,
                select: { id: true }
            });
            
            if (targetStudents.length > 0) {
                await prisma.notification.createMany({
                    data: targetStudents.map(s => ({
                        studentId: s.id,
                        title: `New Study Material: ${material.title}`,
                        message: `New ${material.category.replace('_', ' ')} published for ${material.subject?.code || 'your course'}.`,
                        type: 'assignments',
                        category: 'info',
                        date: new Date().toISOString()
                    })),
                    skipDuplicates: true
                });
            }
        } catch (notifErr) {
            logger.warn('[LMS] Study material notification error:', notifErr.message);
        }
        
        res.status(201).json({ success: true, material });
    } catch (err) {
        logger.error('[LMS] createStudyMaterial error:', err);
        next(err);
    }
};

/**
 * DELETE /api/admin/lms/materials/:id
 */
const deleteStudyMaterial = async (req, res, next) => {
    try {
        const admin = req.admin;
        const { id } = req.params;
        
        const existing = await prisma.studyMaterial.findUnique({ where: { id } });
        if (!existing) {
            return res.status(404).json({ error: 'Study material not found' });
        }
        
        if (admin.role !== 'SUPER_ADMIN') {
            if (existing.uploadedByAdminId !== admin.id && admin.role !== 'HOD') {
                return res.status(403).json({ error: 'You do not have permission to delete this material' });
            }
            if (admin.role === 'HOD') {
                const { canonicals } = await staffScopeService.getAuthorizedDepartments(admin);
                if (existing.branch && !staffScopeService.canAccessBranchWithScopes(canonicals, existing.branch)) {
                    return res.status(403).json({ error: 'Cross-department deletion blocked' });
                }
            }
        }
        
        await prisma.studyMaterial.delete({ where: { id } });
        res.json({ success: true, message: 'Study material deleted' });
    } catch (err) {
        logger.error('[LMS] deleteStudyMaterial error:', err);
        next(err);
    }
};

/**
 * GET /api/admin/lms/assignments
 * List assignments within staff scope.
 */
const getAdminAssignments = async (req, res, next) => {
    try {
        const admin = req.admin;
        const role = admin.role;
        
        if (['HOSTEL_WARDEN', 'SECURITY_GUARD', 'ACCOUNTS_ADMIN', 'PLACEMENT_ADMIN'].includes(role)) {
            return res.status(403).json({ error: 'LMS management access denied for your role' });
        }
        
        const { rawAliases } = await staffScopeService.getAuthorizedDepartments(admin);
        let whereClause = {};
        if ((role === 'HOD' || role === 'FACULTY') && rawAliases.length > 0) {
            whereClause = {
                OR: [
                    { branch: { in: rawAliases } },
                    { branch: 'ALL' },
                    { branch: '' },
                    { createdByAdminId: admin.id }
                ]
            };
        }
        
        const assignments = await prisma.lmsAssignment.findMany({
            where: whereClause,
            include: {
                subject: { select: { id: true, code: true, name: true } },
                createdByAdmin: { select: { id: true, name: true, role: true } },
                _count: {
                    select: { submissions: true }
                }
            },
            orderBy: { dueDate: 'desc' }
        });
        
        // Enrich each assignment with pending/graded counts
        const enriched = await Promise.all(assignments.map(async (a) => {
            const gradedCount = await prisma.lmsSubmission.count({
                where: { assignmentId: a.id, marks: { not: null } }
            });
            return {
                ...a,
                totalSubmissions: a._count.submissions,
                gradedSubmissions: gradedCount,
                pendingGrading: a._count.submissions - gradedCount
            };
        }));
        
        res.json({ success: true, assignments: enriched });
    } catch (err) {
        logger.error('[LMS] getAdminAssignments error:', err);
        next(err);
    }
};

/**
 * POST /api/admin/lms/assignments
 * Create a new assignment.
 */
const createAssignment = async (req, res, next) => {
    try {
        const admin = req.admin;
        const role = admin.role;
        
        if (!['SUPER_ADMIN', 'HOD', 'FACULTY'].includes(role)) {
            return res.status(403).json({ error: 'Only Super Admin, HOD, and Faculty can create assignments' });
        }
        
        const { title, description, instructions, dueDate, maxMarks, subjectId, branch, year, semester, section, attachmentUrl, attachmentName } = req.body;
        
        if (!title || !title.trim()) {
            return res.status(400).json({ error: 'Assignment title is required' });
        }
        if (!dueDate) {
            return res.status(400).json({ error: 'Due date is required' });
        }
        
        const parsedMaxMarks = Number(maxMarks) > 0 ? Number(maxMarks) : 100;
        
        // Scope Check for HOD & Faculty
        if (role === 'HOD' || role === 'FACULTY') {
            const { canonicals } = await staffScopeService.getAuthorizedDepartments(admin);
            if (branch && branch !== 'ALL' && branch.trim() !== '') {
                if (!staffScopeService.canAccessBranchWithScopes(canonicals, branch)) {
                    return res.status(403).json({ error: 'Cannot create assignment for unauthorized department' });
                }
            }
        }
        
        let subjectCode = null;
        let subjectName = null;
        if (subjectId) {
            const subj = await prisma.subject.findUnique({ where: { id: subjectId } });
            if (subj) {
                subjectCode = subj.code;
                subjectName = subj.name;
            }
        }
        
        const assignment = await prisma.lmsAssignment.create({
            data: {
                title: title.trim(),
                description: description ? description.trim() : null,
                instructions: instructions ? instructions.trim() : null,
                dueDate: new Date(dueDate),
                maxMarks: parsedMaxMarks,
                subjectId: subjectId || null,
                subjectCode,
                subjectName,
                attachmentUrl: attachmentUrl || null,
                attachmentName: attachmentName || null,
                createdByAdminId: admin.id,
                createdByName: admin.name,
                createdByRole: admin.role,
                branch: branch || 'ALL',
                year: year || 'ALL',
                semester: semester || 'ALL',
                section: section || 'ALL',
                status: 'PUBLISHED'
            },
            include: {
                subject: { select: { id: true, code: true, name: true } }
            }
        });
        
        // Send Push / System Notification to eligible target students
        try {
            let studentWhere = {};
            if (assignment.branch && assignment.branch !== 'ALL') {
                const aliases = staffScopeService.getRawAliasesForCanonicals([staffScopeService.canonicalizeBranch(assignment.branch)]);
                studentWhere.branch = { in: aliases };
            }
            if (assignment.year && assignment.year !== 'ALL') studentWhere.year = assignment.year;
            if (assignment.semester && assignment.semester !== 'ALL') studentWhere.semester = assignment.semester;
            
            const eligibleStudents = await prisma.student.findMany({
                where: studentWhere,
                select: { id: true }
            });
            
            if (eligibleStudents.length > 0) {
                const formattedDue = new Date(assignment.dueDate).toLocaleDateString('en-GB', {
                    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'
                });
                await prisma.notification.createMany({
                    data: eligibleStudents.map(s => ({
                        studentId: s.id,
                        title: `New Assignment: ${assignment.title}`,
                        message: `New ${subjectCode || 'course'} assignment published. Due: ${formattedDue}. Max Marks: ${parsedMaxMarks}.`,
                        type: 'assignments',
                        category: 'alert',
                        date: new Date().toISOString(),
                        metadata: JSON.stringify({ assignmentId: assignment.id })
                    })),
                    skipDuplicates: true
                });
            }
        } catch (notifErr) {
            logger.warn('[LMS] Assignment notification error:', notifErr.message);
        }
        
        res.status(201).json({ success: true, assignment });
    } catch (err) {
        logger.error('[LMS] createAssignment error:', err);
        next(err);
    }
};

/**
 * GET /api/admin/lms/assignments/:id/submissions
 * Retrieve all student submissions for an assignment. Enforces departmental staff scoping.
 */
const getAssignmentSubmissions = async (req, res, next) => {
    try {
        const admin = req.admin;
        const role = admin.role;
        const { id } = req.params;
        
        if (['HOSTEL_WARDEN', 'SECURITY_GUARD', 'ACCOUNTS_ADMIN', 'PLACEMENT_ADMIN'].includes(role)) {
            return res.status(403).json({ error: 'LMS access denied' });
        }
        
        const assignment = await prisma.lmsAssignment.findUnique({
            where: { id },
            include: { subject: true }
        });
        
        if (!assignment) {
            return res.status(404).json({ error: 'Assignment not found' });
        }
        
        // Scope Validation for HOD/Faculty
        if (role === 'HOD' || role === 'FACULTY') {
            const { canonicals } = await staffScopeService.getAuthorizedDepartments(admin);
            if (assignment.branch && assignment.branch !== 'ALL') {
                if (!staffScopeService.canAccessBranchWithScopes(canonicals, assignment.branch)) {
                    return res.status(403).json({ error: 'Cross-department submission access blocked' });
                }
            }
        }
        
        const submissions = await prisma.lmsSubmission.findMany({
            where: { assignmentId: id },
            include: {
                student: {
                    select: {
                        id: true, name: true, roll: true, branch: true, year: true, semester: true, section: true
                    }
                },
                gradedByAdmin: {
                    select: { id: true, name: true }
                }
            },
            orderBy: { submittedAt: 'desc' }
        });
        
        res.json({ success: true, assignment, submissions });
    } catch (err) {
        logger.error('[LMS] getAssignmentSubmissions error:', err);
        next(err);
    }
};

/**
 * POST /api/admin/lms/submissions/:id/grade
 * Grade a student submission.
 */
const gradeSubmission = async (req, res, next) => {
    try {
        const admin = req.admin;
        const role = admin.role;
        const { id } = req.params;
        const { marks, feedback } = req.body;
        
        if (!['SUPER_ADMIN', 'HOD', 'FACULTY'].includes(role)) {
            return res.status(403).json({ error: 'Only Super Admin, HOD, and Faculty can grade submissions' });
        }
        
        const submission = await prisma.lmsSubmission.findUnique({
            where: { id },
            include: {
                assignment: true,
                student: { select: { id: true, name: true, roll: true, branch: true } }
            }
        });
        
        if (!submission) {
            return res.status(404).json({ error: 'Submission not found' });
        }
        
        const maxMarks = submission.assignment.maxMarks || 100;
        const numMarks = Number(marks);
        
        if (isNaN(numMarks)) {
            return res.status(400).json({ error: 'Numeric marks value is required' });
        }
        if (numMarks < 0) {
            return res.status(400).json({ error: 'Marks cannot be negative' });
        }
        if (numMarks > maxMarks) {
            return res.status(400).json({ error: `Marks cannot exceed maximum marks (${maxMarks})` });
        }
        
        // Scope Validation for HOD & Faculty
        if (role === 'HOD' || role === 'FACULTY') {
            const { canonicals } = await staffScopeService.getAuthorizedDepartments(admin);
            if (submission.assignment.branch && submission.assignment.branch !== 'ALL') {
                if (!staffScopeService.canAccessBranchWithScopes(canonicals, submission.assignment.branch)) {
                    return res.status(403).json({ error: 'Cross-department grading blocked' });
                }
            }
        }
        
        // Derive Grade letter code
        let gradeLetter = 'Pass';
        const pct = (numMarks / maxMarks) * 100;
        if (pct >= 90) gradeLetter = 'A+';
        else if (pct >= 80) gradeLetter = 'A';
        else if (pct >= 70) gradeLetter = 'B';
        else if (pct >= 60) gradeLetter = 'C';
        else if (pct >= 50) gradeLetter = 'D';
        else gradeLetter = 'F';
        
        const updated = await prisma.lmsSubmission.update({
            where: { id },
            data: {
                marks: numMarks,
                grade: gradeLetter,
                feedback: feedback ? feedback.trim() : null,
                status: 'GRADED',
                gradedAt: new Date(),
                gradedByAdminId: admin.id,
                gradedByName: admin.name
            },
            include: {
                student: { select: { id: true, name: true, roll: true } }
            }
        });
        
        // Send Notification to Student
        try {
            await prisma.notification.create({
                data: {
                    studentId: submission.studentId,
                    title: `Assignment Graded: ${submission.assignment.title}`,
                    message: `Your assignment submission was graded: ${numMarks}/${maxMarks} (${gradeLetter}). ${feedback ? `Feedback: "${feedback}"` : ''}`,
                    type: 'assignments',
                    category: 'success',
                    date: new Date().toISOString(),
                    metadata: JSON.stringify({ assignmentId: submission.assignmentId, marks: numMarks, maxMarks })
                }
            });
        } catch (notifErr) {
            logger.warn('[LMS] Grade notification error:', notifErr.message);
        }
        
        res.json({ success: true, submission: updated });
    } catch (err) {
        logger.error('[LMS] gradeSubmission error:', err);
        next(err);
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// STUDENT LMS CONTROLLERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/lms/courses
 * Fetch enrolled courses, study materials, and assignments for the authenticated student.
 */
const getStudentLmsCourses = async (req, res, next) => {
    try {
        const userId = req.session?.userId || req.user?.userId || req.user?.id;
        const student = await prisma.student.findFirst({
            where: { OR: [{ id: userId }, { userId: userId }, { roll: userId }] }
        });
        
        if (!student) {
            return res.status(404).json({ error: 'Student record not found' });
        }
        
        // Find matching subjects for student's branch/semester
        const studentCanon = staffScopeService.canonicalizeBranch(student.branch);
        const aliases = staffScopeService.getRawAliasesForCanonicals([studentCanon]);
        
        const subjects = await prisma.subject.findMany({
            where: {
                OR: [
                    { branch: { in: aliases } },
                    { semester: student.semester }
                ]
            },
            orderBy: { code: 'asc' }
        });
        
        // Fetch all assignments targeted to student's academic scope
        const assignments = await prisma.lmsAssignment.findMany({
            where: {
                status: 'PUBLISHED',
                OR: [
                    { branch: 'ALL' },
                    { branch: { in: aliases } }
                ]
            },
            include: {
                submissions: {
                    where: { studentId: student.id }
                }
            },
            orderBy: { dueDate: 'asc' }
        });
        
        // Fetch all study materials targeted to student's academic scope
        const studyMaterials = await prisma.studyMaterial.findMany({
            where: {
                OR: [
                    { branch: 'ALL' },
                    { branch: { in: aliases } }
                ]
            },
            orderBy: { createdAt: 'desc' }
        });
        
        // Map courses with their respective assignments and materials
        const courses = subjects.map(s => {
            const courseAssignments = assignments.filter(a => a.subjectId === s.id || a.subjectCode === s.code);
            const courseMaterials = studyMaterials.filter(m => m.subjectId === s.id);
            
            // Calculate progress based on submitted/graded assignments
            const totalAsn = courseAssignments.length;
            const completedAsn = courseAssignments.filter(a => a.submissions.length > 0).length;
            const progressPct = totalAsn > 0 ? Math.round((completedAsn / totalAsn) * 100) : 75;
            
            return {
                id: s.id,
                code: s.code,
                name: s.name,
                credits: s.credits,
                semester: s.semester,
                branch: s.branch,
                progress: { progressPct },
                assignments: courseAssignments.map(a => {
                    const sub = a.submissions[0] || null;
                    return {
                        id: a.id,
                        title: a.title,
                        description: a.description,
                        dueDate: a.dueDate,
                        maxPoints: a.maxMarks,
                        status: deriveAssignmentStatus(a, sub),
                        submission: sub ? {
                            id: sub.id,
                            submittedAt: sub.submittedAt,
                            points: sub.marks,
                            grade: sub.grade,
                            feedback: sub.feedback
                        } : null
                    };
                }),
                studyMaterials: courseMaterials
            };
        });
        
        res.json({
            success: true,
            courses,
            certificates: [
                { id: 'cert-1', title: 'Dean\'s Honor Roll — Academic Excellence', date: '2025-12-15', issuer: 'SITAM Academic Council' }
            ]
        });
    } catch (err) {
        logger.error('[LMS] getStudentLmsCourses error:', err);
        next(err);
    }
};

/**
 * GET /api/lms/materials
 * List study materials eligible for the student.
 */
const getStudentMaterials = async (req, res, next) => {
    try {
        const userId = req.session?.userId || req.user?.userId || req.user?.id;
        const student = await prisma.student.findFirst({
            where: { OR: [{ id: userId }, { userId: userId }, { roll: userId }] }
        });
        
        if (!student) {
            return res.status(404).json({ error: 'Student record not found' });
        }
        
        const studentCanon = staffScopeService.canonicalizeBranch(student.branch);
        const aliases = staffScopeService.getRawAliasesForCanonicals([studentCanon]);
        
        const materials = await prisma.studyMaterial.findMany({
            where: {
                OR: [
                    { branch: 'ALL' },
                    { branch: { in: aliases } }
                ]
            },
            include: {
                subject: { select: { id: true, code: true, name: true } },
                uploadedByAdmin: { select: { name: true, role: true } }
            },
            orderBy: { createdAt: 'desc' }
        });
        
        // Filter strictly by eligibility
        const eligible = materials.filter(m => isStudentEligible(student, m.branch, m.year, m.semester, m.section));
        res.json({ success: true, list: eligible });
    } catch (err) {
        logger.error('[LMS] getStudentMaterials error:', err);
        next(err);
    }
};

/**
 * GET /api/lms/assignments
 * List all assignments eligible for the student with deadline engine status.
 */
const getStudentAssignments = async (req, res, next) => {
    try {
        const userId = req.session?.userId || req.user?.userId || req.user?.id;
        const student = await prisma.student.findFirst({
            where: { OR: [{ id: userId }, { userId: userId }, { roll: userId }] }
        });
        
        if (!student) {
            return res.status(404).json({ error: 'Student record not found' });
        }
        
        const studentCanon = staffScopeService.canonicalizeBranch(student.branch);
        const aliases = staffScopeService.getRawAliasesForCanonicals([studentCanon]);
        
        const assignments = await prisma.lmsAssignment.findMany({
            where: {
                status: 'PUBLISHED',
                OR: [
                    { branch: 'ALL' },
                    { branch: { in: aliases } }
                ]
            },
            include: {
                subject: { select: { id: true, code: true, name: true } },
                submissions: {
                    where: { studentId: student.id }
                }
            },
            orderBy: { dueDate: 'asc' }
        });
        
        const eligible = assignments.filter(a => isStudentEligible(student, a.branch, a.year, a.semester, a.section));
        
        const formatted = eligible.map(a => {
            const sub = a.submissions[0] || null;
            const statusStr = deriveAssignmentStatus(a, sub);
            return {
                id: a.id,
                title: a.title,
                subject: a.subjectCode || a.subject?.code || 'General',
                subjectName: a.subjectName || a.subject?.name || '',
                description: a.description,
                instructions: a.instructions,
                dueDate: a.dueDate,
                date: new Date(a.dueDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
                maxMarks: a.maxMarks,
                attachmentUrl: a.attachmentUrl,
                attachmentName: a.attachmentName,
                status: statusStr,
                submission: sub ? {
                    id: sub.id,
                    submissionText: sub.submissionText,
                    fileUrl: sub.fileUrl,
                    fileName: sub.fileName,
                    submittedAt: sub.submittedAt,
                    marks: sub.marks,
                    grade: sub.grade,
                    feedback: sub.feedback,
                    gradedAt: sub.gradedAt
                } : null
            };
        });
        
        res.json({ success: true, list: formatted });
    } catch (err) {
        logger.error('[LMS] getStudentAssignments error:', err);
        next(err);
    }
};

/**
 * POST /api/lms/assignments/:id/submit
 * Submit work for an assignment. Student identity is strictly derived from session JWT.
 */
const submitAssignment = async (req, res, next) => {
    try {
        const userId = req.session?.userId || req.user?.userId || req.user?.id;
        const student = await prisma.student.findFirst({
            where: { OR: [{ id: userId }, { userId: userId }, { roll: userId }] }
        });
        
        if (!student) {
            return res.status(401).json({ error: 'Authenticated student identity not found' });
        }
        
        const { id } = req.params;
        const { submissionText, fileUrl, fileName } = req.body;
        
        const assignment = await prisma.lmsAssignment.findUnique({
            where: { id }
        });
        
        if (!assignment || assignment.status !== 'PUBLISHED') {
            return res.status(404).json({ error: 'Published assignment not found' });
        }
        
        // Scope Validation: Check student eligibility
        if (!isStudentEligible(student, assignment.branch, assignment.year, assignment.semester, assignment.section)) {
            return res.status(403).json({ error: 'You are not eligible to submit to this assignment' });
        }
        
        // Determine On-Time vs Late
        const now = new Date();
        const isLate = now > new Date(assignment.dueDate);
        const initialStatus = isLate ? 'LATE' : 'SUBMITTED';
        
        // Check if student has already submitted
        const existing = await prisma.lmsSubmission.findUnique({
            where: {
                assignmentId_studentId: {
                    assignmentId: id,
                    studentId: student.id
                }
            }
        });
        
        if (existing && existing.status === 'GRADED') {
            return res.status(400).json({ error: 'Assignment has already been graded. Resubmission is locked.' });
        }
        
        let submission;
        if (existing) {
            // Update existing submission
            submission = await prisma.lmsSubmission.update({
                where: { id: existing.id },
                data: {
                    submissionText: submissionText ? submissionText.trim() : existing.submissionText,
                    fileUrl: fileUrl || existing.fileUrl,
                    fileName: fileName || existing.fileName,
                    submittedAt: now,
                    status: initialStatus
                }
            });
        } else {
            // Create new submission
            submission = await prisma.lmsSubmission.create({
                data: {
                    assignmentId: id,
                    studentId: student.id,
                    submissionText: submissionText ? submissionText.trim() : null,
                    fileUrl: fileUrl || null,
                    fileName: fileName || null,
                    submittedAt: now,
                    status: initialStatus
                }
            });
        }
        
        res.status(201).json({
            success: true,
            message: isLate ? 'Assignment submitted (Late)' : 'Assignment submitted successfully',
            submission
        });
    } catch (err) {
        logger.error('[LMS] submitAssignment error:', err);
        next(err);
    }
};

/**
 * GET /api/lms/assignments/:id/my-submission
 * Retrieve authenticated student's submission, grade & feedback (IDOR protected).
 */
const getMySubmission = async (req, res, next) => {
    try {
        const userId = req.session?.userId || req.user?.userId || req.user?.id;
        const student = await prisma.student.findFirst({
            where: { OR: [{ id: userId }, { userId: userId }, { roll: userId }] }
        });
        
        if (!student) {
            return res.status(401).json({ error: 'Authenticated student identity not found' });
        }
        
        const { id } = req.params;
        
        const submission = await prisma.lmsSubmission.findUnique({
            where: {
                assignmentId_studentId: {
                    assignmentId: id,
                    studentId: student.id
                }
            },
            include: {
                assignment: {
                    select: { id: true, title: true, maxMarks: true, dueDate: true }
                }
            }
        });
        
        if (!submission) {
            return res.status(404).json({ error: 'No submission found for this assignment' });
        }
        
        res.json({ success: true, submission });
    } catch (err) {
        logger.error('[LMS] getMySubmission error:', err);
        next(err);
    }
};

const getAudienceOptions = async (req, res, next) => {
    try {
        const hierarchy = await staffScopeService.getAudienceHierarchy(req.admin);
        res.json(hierarchy);
    } catch (err) {
        logger.error('[LMS] getAudienceOptions error:', err);
        next(err);
    }
};

module.exports = {
    getAdminCourses,
    getAdminMaterials,
    createStudyMaterial,
    deleteStudyMaterial,
    getAdminAssignments,
    createAssignment,
    getAssignmentSubmissions,
    gradeSubmission,
    getStudentLmsCourses,
    getStudentMaterials,
    getStudentAssignments,
    submitAssignment,
    getMySubmission,
    getAudienceOptions
};
