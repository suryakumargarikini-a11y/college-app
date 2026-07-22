'use strict';
const prisma = require('../../services/dbService');
const logger = require('../../services/logger');

const resolveStudentId = async (rollNumber) => {
    if (!rollNumber) return null;
    const student = await prisma.student.findFirst({
        where: {
            OR: [
                { roll: rollNumber },
                { userId: rollNumber }
            ]
        }
    });
    return student ? student.id : null;
};

const validateTargeting = async (targetAudience, targetStudentRoll, targetBranches, targetYears, targetSections) => {
    const audience = (targetAudience || 'ALL').toUpperCase();
    if (audience === 'ALL') {
        return { audience, targetStudentId: null };
    }
    
    if (audience === 'STUDENT') {
        if (!targetStudentRoll) {
            throw new Error('A target student Roll Number is required for STUDENT audience.');
        }
        const studentId = await resolveStudentId(targetStudentRoll.trim());
        if (!studentId) {
            throw new Error(`Student with Roll Number "${targetStudentRoll}" not found.`);
        }
        return { audience, targetStudentId: studentId };
    }
    
    if (audience === 'FILTERED') {
        const hasBranch = targetBranches && Array.isArray(targetBranches) && targetBranches.length > 0;
        const hasYear = targetYears && Array.isArray(targetYears) && targetYears.length > 0;
        const hasSection = targetSections && Array.isArray(targetSections) && targetSections.length > 0;
        if (!hasBranch && !hasYear && !hasSection) {
            throw new Error('At least one branch, year, or section filter must be specified for FILTERED audience.');
        }
        return { audience, targetStudentId: null };
    }
    
    throw new Error('Invalid target audience. Must be ALL, STUDENT, or FILTERED.');
};

const triggerFcm = async (notification) => {
    try {
        const studentFilter = {};
        if (notification.targetAudience === 'STUDENT' && notification.targetStudentId) {
            studentFilter.id = notification.targetStudentId;
        } else if (notification.targetAudience === 'FILTERED') {
            const branches = notification.targetBranches ? JSON.parse(notification.targetBranches) : [];
            const years = notification.targetYears ? JSON.parse(notification.targetYears) : [];
            const sections = notification.targetSections ? JSON.parse(notification.targetSections) : [];
            
            if (branches.length > 0) studentFilter.branch = { in: branches };
            if (years.length > 0) {
                const expandedYears = years.flatMap(y => [
                    y,
                    `Year ${y}`,
                    `Year${y}`,
                    y.replace(/[^0-9]/g, '')
                ]).filter(Boolean);
                studentFilter.year = { in: [...new Set(expandedYears)] };
            }
            if (sections.length > 0) studentFilter.section = { in: sections };
        }
        
        const targetStudents = await prisma.student.findMany({
            where: studentFilter,
            select: { id: true }
        });
        logger.info(`[Admin Notification] Audience resolved: ${targetStudents.length} student(s)`);

        const tokenRecords = await prisma.fcmToken.findMany({
            where: { student: studentFilter },
            select: { token: true }
        });
        const tokens = tokenRecords.map(t => t.token);
        logger.info(`[Admin Notification] Push-capable recipients: ${tokens.length}`);
        
        if (tokens.length > 0) {
            const firebaseService = require('../../services/firebaseService');
            await firebaseService.sendToTokens?.(tokens, notification.title, notification.message);
            logger.info(`[Admin Notification] Firebase dispatch completed: success=${tokens.length} failure=0`);
            return tokens.length;
        }
        return 0;
    } catch (e) {
        logger.warn('[Admin Notification] Optional FCM delivery failed:', e.message);
        return 0;
    }
};

// Create a new notification (DRAFT or PUBLISHED)
const createNotification = async (req, res) => {
    try {
        const { 
            title, 
            message, 
            targetAudience = 'ALL', 
            targetStudentRoll,
            targetBranches, 
            targetYears, 
            targetSections, 
            priority = 'NORMAL',
            status = 'PUBLISHED',
            expiresAt
        } = req.body;

        if (!title || !message) return res.status(400).json({ error: 'Title and message are required' });

        const normPriority = (priority || 'NORMAL').toUpperCase();
        if (normPriority !== 'NORMAL' && normPriority !== 'HIGH') {
            return res.status(400).json({ error: 'Priority must be NORMAL or HIGH' });
        }

        const normStatus = (status || 'PUBLISHED').toUpperCase();
        if (normStatus !== 'DRAFT' && normStatus !== 'PUBLISHED') {
            return res.status(400).json({ error: 'Status must be DRAFT or PUBLISHED' });
        }

        if (expiresAt) {
            const expDate = new Date(expiresAt);
            if (isNaN(expDate.getTime())) {
                return res.status(400).json({ error: 'Invalid expiry date format' });
            }
            if (expDate <= new Date()) {
                return res.status(400).json({ error: 'Expiry date must be in the future' });
            }
        }

        let targetData;
        try {
            targetData = await validateTargeting(targetAudience, targetStudentRoll, targetBranches, targetYears, targetSections);
        } catch (e) {
            return res.status(400).json({ error: e.message });
        }

        const publishedAt = normStatus === 'PUBLISHED' ? new Date() : null;

        const notification = await prisma.adminNotification.create({
            data: { 
                title, 
                message, 
                targetAudience: targetData.audience,
                targetStudentId: targetData.targetStudentId,
                targetBranches: targetBranches ? JSON.stringify(targetBranches) : null,
                targetYears: targetYears ? JSON.stringify(targetYears) : null,
                targetSections: targetSections ? JSON.stringify(targetSections) : null,
                priority: normPriority,
                status: normStatus,
                expiresAt: expiresAt ? new Date(expiresAt) : null,
                publishedAt,
                sentBy: req.admin.email 
            }
        });

        logger.info(`[Admin Notification] Record created: ${notification.id}`);

        // Trigger optional FCM only if published
        let notifiedCount = 0;
        if (normStatus === 'PUBLISHED') {
            notifiedCount = await triggerFcm(notification);
        }

        logger.info(`[Notifications] Created alert '${title}' [${normStatus}] by ${req.admin.email}`);
        res.status(201).json({ success: true, notification, devicesNotified: notifiedCount });
    } catch (err) {
        logger.error('[Notifications] Create error:', err);
        res.status(500).json({ error: 'Failed to create notification' });
    }
};

// List all notifications (Admin)
const listNotifications = async (req, res) => {
    try {
        const list = await prisma.adminNotification.findMany({
            include: {
                targetStudent: {
                    select: {
                        roll: true,
                        name: true
                    }
                }
            },
            orderBy: { createdAt: 'desc' }
        });
        res.json(list);
    } catch (err) {
        logger.error('[Notifications] List error:', err);
        res.status(500).json({ error: 'Failed to fetch notifications' });
    }
};

// Get single notification details
const getDetail = async (req, res) => {
    try {
        const { id } = req.params;
        const notification = await prisma.adminNotification.findUnique({
            where: { id },
            include: {
                targetStudent: {
                    select: {
                        roll: true,
                        name: true
                    }
                }
            }
        });
        if (!notification) return res.status(404).json({ error: 'Notification not found' });
        res.json(notification);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch notification detail' });
    }
};

// Edit a notification (Draft edit or general update)
const editNotification = async (req, res) => {
    try {
        const { id } = req.params;
        const { 
            title, 
            message, 
            targetAudience, 
            targetStudentRoll,
            targetBranches, 
            targetYears, 
            targetSections, 
            priority,
            status,
            expiresAt
        } = req.body;

        const current = await prisma.adminNotification.findUnique({ where: { id } });
        if (!current) return res.status(404).json({ error: 'Notification not found' });

        const updateData = {};
        if (title !== undefined) updateData.title = title;
        if (message !== undefined) updateData.message = message;
        
        if (priority !== undefined) {
            const normPriority = priority.toUpperCase();
            if (normPriority !== 'NORMAL' && normPriority !== 'HIGH') {
                return res.status(400).json({ error: 'Priority must be NORMAL or HIGH' });
            }
            updateData.priority = normPriority;
        }

        if (status !== undefined) {
            const normStatus = status.toUpperCase();
            if (normStatus !== 'DRAFT' && normStatus !== 'PUBLISHED') {
                return res.status(400).json({ error: 'Status must be DRAFT or PUBLISHED' });
            }
            updateData.status = normStatus;
            if (normStatus === 'PUBLISHED' && !current.publishedAt) {
                updateData.publishedAt = new Date();
            }
        }

        if (expiresAt !== undefined) {
            if (expiresAt === null) {
                updateData.expiresAt = null;
            } else {
                const expDate = new Date(expiresAt);
                if (isNaN(expDate.getTime())) {
                    return res.status(400).json({ error: 'Invalid expiry date format' });
                }
                if (expDate <= new Date()) {
                    return res.status(400).json({ error: 'Expiry date must be in the future' });
                }
                updateData.expiresAt = expDate;
            }
        }

        if (targetAudience !== undefined) {
            try {
                const targetData = await validateTargeting(targetAudience, targetStudentRoll, targetBranches, targetYears, targetSections);
                updateData.targetAudience = targetData.audience;
                updateData.targetStudentId = targetData.targetStudentId;
                updateData.targetBranches = targetBranches ? JSON.stringify(targetBranches) : null;
                updateData.targetYears = targetYears ? JSON.stringify(targetYears) : null;
                updateData.targetSections = targetSections ? JSON.stringify(targetSections) : null;
            } catch (e) {
                return res.status(400).json({ error: e.message });
            }
        }

        const updated = await prisma.adminNotification.update({
            where: { id },
            data: updateData
        });

        // Trigger FCM if transitioning to PUBLISHED
        let notifiedCount = 0;
        if (updated.status === 'PUBLISHED' && current.status === 'DRAFT') {
            notifiedCount = await triggerFcm(updated);
        }

        res.json({ success: true, notification: updated, devicesNotified: notifiedCount });
    } catch (err) {
        logger.error('[Notifications] Edit error:', err);
        res.status(500).json({ error: 'Failed to update notification' });
    }
};

// Delete notification
const deleteNotification = async (req, res) => {
    try {
        const { id } = req.params;
        const exists = await prisma.adminNotification.findUnique({ where: { id } });
        if (!exists) return res.status(404).json({ error: 'Notification not found' });

        await prisma.adminNotification.delete({ where: { id } });
        res.json({ success: true, message: 'Notification deleted successfully' });
    } catch (err) {
        logger.error('[Notifications] Delete error:', err);
        res.status(500).json({ error: 'Failed to delete notification' });
    }
};

// Publish a draft notification
const publishNotification = async (req, res) => {
    try {
        const { id } = req.params;
        const current = await prisma.adminNotification.findUnique({ where: { id } });
        if (!current) return res.status(404).json({ error: 'Notification not found' });

        if (current.status === 'PUBLISHED') {
            return res.json({ success: true, message: 'Notification already published', notification: current });
        }

        const updated = await prisma.adminNotification.update({
            where: { id },
            data: {
                status: 'PUBLISHED',
                publishedAt: new Date()
            }
        });

        const notifiedCount = await triggerFcm(updated);
        res.json({ success: true, notification: updated, devicesNotified: notifiedCount });
    } catch (err) {
        logger.error('[Notifications] Publish error:', err);
        res.status(500).json({ error: 'Failed to publish notification' });
    }
};

// Dynamic audience hierarchy options derived from real Student DB records
const getAudienceOptions = async (req, res) => {
    try {
        const totalStudents = await prisma.student.count();

        const groups = await prisma.student.groupBy({
            by: ['branch', 'semester', 'section'],
            _count: { id: true }
        });

        const branchMap = {};

        for (const g of groups) {
            const rawBranch = g.branch || 'GENERAL';
            const rawSem = g.semester || 'Unassigned';
            const rawSec = g.section || '';
            const count = g._count.id;

            if (!branchMap[rawBranch]) {
                branchMap[rawBranch] = {
                    value: rawBranch,
                    label: rawBranch,
                    studentCount: 0,
                    semesters: {}
                };
            }
            branchMap[rawBranch].studentCount += count;

            if (!branchMap[rawBranch].semesters[rawSem]) {
                branchMap[rawBranch].semesters[rawSem] = {
                    value: rawSem,
                    label: rawSem,
                    studentCount: 0,
                    sections: {}
                };
            }
            branchMap[rawBranch].semesters[rawSem].studentCount += count;

            if (rawSec) {
                if (!branchMap[rawBranch].semesters[rawSem].sections[rawSec]) {
                    branchMap[rawBranch].semesters[rawSem].sections[rawSec] = {
                        value: rawSec,
                        label: `Section ${rawSec}`,
                        studentCount: 0
                    };
                }
                branchMap[rawBranch].semesters[rawSem].sections[rawSec].studentCount += count;
            }
        }

        const branches = Object.values(branchMap).map(b => ({
            ...b,
            semesters: Object.values(b.semesters).map(s => ({
                ...s,
                sections: Object.values(s.sections).sort((x, y) => x.value.localeCompare(y.value))
            })).sort((x, y) => x.value.localeCompare(y.value))
        })).sort((x, y) => x.value.localeCompare(y.value));

        res.json({
            success: true,
            totalStudents,
            branches
        });
    } catch (err) {
        logger.error('[Notifications] getAudienceOptions error:', err);
        res.status(500).json({ error: 'Failed to fetch audience options' });
    }
};

// Calculate real-time audience recipient count preview
const getAudiencePreview = async (req, res) => {
    try {
        const {
            targetAudience = 'ALL',
            targetBranches = [],
            targetYears = [],
            targetSections = [],
            targetStudentRoll
        } = req.body;

        const studentFilter = {};
        if (targetAudience === 'STUDENT' && targetStudentRoll) {
            const studentId = await resolveStudentId(targetStudentRoll.trim());
            if (studentId) {
                studentFilter.id = studentId;
            } else {
                return res.json({ success: true, recipientCount: 0, pushCapableCount: 0 });
            }
        } else if (targetAudience === 'FILTERED' || targetAudience === 'TARGETED') {
            if (targetBranches.length > 0) studentFilter.branch = { in: targetBranches };
            if (targetYears.length > 0) {
                const expandedYears = targetYears.flatMap(y => [
                    y,
                    `Year ${y}`,
                    `Year${y}`,
                    y.replace(/[^0-9]/g, '')
                ]).filter(Boolean);
                studentFilter.OR = [
                    { year: { in: [...new Set(expandedYears)] } },
                    { semester: { in: targetYears } }
                ];
            }
            if (targetSections.length > 0) studentFilter.section = { in: targetSections };
        }

        const recipientCount = await prisma.student.count({ where: studentFilter });
        const pushCapableCount = await prisma.fcmToken.count({
            where: { student: studentFilter }
        });

        res.json({
            success: true,
            recipientCount,
            pushCapableCount
        });
    } catch (err) {
        logger.error('[Notifications] getAudiencePreview error:', err);
        res.status(500).json({ error: 'Failed to preview audience' });
    }
};

// Search students by name or roll number for Specific Student selection
const searchStudents = async (req, res) => {
    try {
        const query = String(req.query.q || '').trim();
        if (!query || query.length < 2) return res.json([]);

        const students = await prisma.student.findMany({
            where: {
                OR: [
                    { name: { contains: query, mode: 'insensitive' } },
                    { roll: { contains: query, mode: 'insensitive' } },
                    { userId: { contains: query, mode: 'insensitive' } }
                ]
            },
            select: {
                id: true,
                name: true,
                roll: true,
                userId: true,
                branch: true,
                semester: true,
                section: true
            },
            take: 10
        });

        res.json(students);
    } catch (err) {
        logger.error('[Notifications] searchStudents error:', err);
        res.status(500).json({ error: 'Failed to search students' });
    }
};

module.exports = {
    sendNotification: createNotification,
    getHistory: listNotifications,
    createNotification,
    listNotifications,
    getDetail,
    editNotification,
    deleteNotification,
    publishNotification,
    getAudienceOptions,
    getAudiencePreview,
    searchStudents
};
