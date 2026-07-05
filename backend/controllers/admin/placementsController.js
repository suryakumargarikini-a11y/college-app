'use strict';
const prisma = require('../../services/dbService');
const logger = require('../../services/logger');
const { auditLogRepository } = require('../../repositories/index');

const getAll = async (req, res) => {
    try {
        const placements = await prisma.placement.findMany({ orderBy: { createdAt: 'desc' } });
        res.json(placements);
    } catch (err) { res.status(500).json({ error: 'Failed to fetch placements' }); }
};

const create = async (req, res) => {
    try {
        const {
            companyName, companyLogoUrl, jobRole, packageLpa,
            eligibility, description, registrationLink, driveDate, status = 'DRAFT',
            companyArrivedToday = false
        } = req.body;

        if (!companyName || !jobRole || !packageLpa || !eligibility || !description || !registrationLink || !driveDate) {
            return res.status(400).json({ error: 'All fields are required' });
        }

        const placement = await prisma.placement.create({
            data: {
                companyName,
                companyLogoUrl: companyLogoUrl || null,
                jobRole, packageLpa, eligibility, description,
                registrationLink, driveDate, status, companyArrivedToday
            }
        });
        logger.info(`[Placements] Created: ${companyName} by admin ${req.admin.email}`);

        // If published immediately, fire FCM notification and log to audit logs
        if (status === 'PUBLISHED') {
            try {
                const firebaseService = require('../../services/firebaseService');
                firebaseService.broadcastToAllStudents?.(
                    `New Placement Drive: ${companyName}`,
                    `${jobRole} — ₹${packageLpa} LPA. Drive date: ${driveDate}`
                ).catch(() => {});
            } catch (_) {}

            await auditLogRepository.log(
                null, 
                'PLACEMENT_PUBLISHED', 
                `Placement drive for '${companyName}' published by admin ${req.admin.email}`, 
                req.admin.id, 
                'INFO'
            );
        }

        res.status(201).json(placement);
    } catch (err) { res.status(500).json({ error: 'Failed to create placement' }); }
};

const update = async (req, res) => {
    try {
        const { id } = req.params;
        const data = req.body;
        const prev = await prisma.placement.findUnique({ where: { id } });
        const placement = await prisma.placement.update({ where: { id }, data });

        // Trigger notification if just published for the first time
        if (data.status === 'PUBLISHED' && prev?.status !== 'PUBLISHED') {
            if (!prev?.notificationSent) {
                try {
                    const firebaseService = require('../../services/firebaseService');
                    await firebaseService.broadcastToAllStudents?.(
                        `New Placement Drive: ${placement.companyName}`,
                        `${placement.jobRole} — ₹${placement.packageLpa} LPA`
                    );
                    await prisma.placement.update({ where: { id }, data: { notificationSent: true } });
                } catch (_) {}
            }

            await auditLogRepository.log(
                null, 
                'PLACEMENT_PUBLISHED', 
                `Placement drive for '${placement.companyName}' published by admin ${req.admin.email}`, 
                req.admin.id, 
                'INFO'
            );
        }

        // Audit log if toggled arrived status
        if (data.companyArrivedToday === true && !prev?.companyArrivedToday) {
            await auditLogRepository.log(
                null,
                'PLACEMENT_PUBLISHED',
                `Company '${placement.companyName}' marked as Arrived On Campus Today by admin ${req.admin.email}`,
                req.admin.id,
                'INFO'
            );
        }

        res.json(placement);
    } catch (err) { res.status(500).json({ error: 'Failed to update placement' }); }
};

const remove = async (req, res) => {
    try {
        await prisma.placement.delete({ where: { id: req.params.id } });
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Failed to delete placement' }); }
};

// Student-facing: published only, ordered by drive date ascending
const getPublished = async (req, res) => {
    try {
        let studentId = req.session?.studentId;
        if (!studentId && req.session?.userId) {
            const student = await prisma.student.findUnique({ where: { userId: req.session.userId } });
            studentId = student?.id;
        }
        if (!studentId) return res.status(401).json({ error: 'Not authenticated' });

        const placements = await prisma.placement.findMany({
            where: { status: 'PUBLISHED' },
            include: {
                savedPlacements: {
                    where: { studentId }
                }
            },
            orderBy: { driveDate: 'asc' }
        });
        
        const formatted = placements.map(p => {
            const { savedPlacements, ...rest } = p;
            return {
                ...rest,
                isSaved: savedPlacements.length > 0
            };
        });

        res.json({ placements: formatted });
    } catch (err) { res.status(500).json({ error: 'Failed to fetch placements' }); }
};

const saveToggle = async (req, res) => {
    try {
        let studentId = req.session?.studentId;
        if (!studentId && req.session?.userId) {
            const student = await prisma.student.findUnique({ where: { userId: req.session.userId } });
            studentId = student?.id;
        }
        if (!studentId) return res.status(401).json({ error: 'Not authenticated' });
        
        const { id } = req.params;

        const existing = await prisma.savedPlacement.findUnique({
            where: {
                studentId_placementId: {
                    studentId,
                    placementId: id
                }
            }
        });

        if (existing) {
            await prisma.savedPlacement.delete({
                where: { id: existing.id }
            });
            return res.json({ success: true, saved: false, message: 'Placement unsaved' });
        } else {
            await prisma.savedPlacement.create({
                data: {
                    studentId,
                    placementId: id
                }
            });
            return res.json({ success: true, saved: true, message: 'Placement saved' });
        }
    } catch (err) {
        res.status(500).json({ error: 'Failed to toggle save state' });
    }
};

const getSaved = async (req, res) => {
    try {
        let studentId = req.session?.studentId;
        if (!studentId && req.session?.userId) {
            const student = await prisma.student.findUnique({ where: { userId: req.session.userId } });
            studentId = student?.id;
        }
        if (!studentId) return res.status(401).json({ error: 'Not authenticated' });

        const saved = await prisma.savedPlacement.findMany({
            where: { studentId },
            include: {
                placement: true
            },
            orderBy: { savedAt: 'desc' }
        });

        const placements = saved.map(s => ({
            ...s.placement,
            isSaved: true
        }));

        res.json({ placements });
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch saved placements' });
    }
};

module.exports = { getAll, create, update, remove, getPublished, saveToggle, getSaved };
