'use strict';

const fs = require('fs');
const prisma = require('../services/dbService');
const imageStorage = require('../services/imageStorage');
const logger = require('../services/logger');
const staffScopeService = require('../services/staffScopeService');

const VALID_CATEGORIES = [
    'Student', 'Faculty', 'Research', 'Sports',
    'Competition', 'Placement', 'Cultural', 'Other'
];

/**
 * Admin LIST Achievements:
 * - SUPER_ADMIN, DEAN, CI: View all, filter by branch/category/isPublished/q.
 * - HOD: Strictly restricted to their authorized branch scopes.
 */
async function getAdminAchievements(req, res, next) {
    try {
        const admin = req.admin;
        if (!admin) return res.status(401).json({ error: 'Admin session required' });

        const where = {};
        const q = String(req.query.q || '').trim();
        const category = String(req.query.category || '').trim();
        const isPublished = req.query.isPublished;

        if (q) {
            where.OR = [
                { title: { contains: q, mode: 'insensitive' } },
                { description: { contains: q, mode: 'insensitive' } },
                { participantName: { contains: q, mode: 'insensitive' } }
            ];
        }

        if (category && category !== 'ALL') {
            where.category = category;
        }

        if (isPublished !== undefined && isPublished !== 'ALL' && isPublished !== '') {
            where.isPublished = String(isPublished) === 'true';
        }

        if (admin.role === 'HOD') {
            const { rawAliases } = await staffScopeService.getAuthorizedDepartments(admin);
            if (req.query.branch && req.query.branch !== 'ALL') {
                const requestedCanon = staffScopeService.canonicalizeBranch(req.query.branch);
                const authorizedCanonicals = (await staffScopeService.getAuthorizedDepartments(admin)).canonicals;
                if (!authorizedCanonicals.includes(requestedCanon)) {
                    return res.status(403).json({
                        error: `Forbidden: HOD lacks authorization for requested branch '${req.query.branch}'`
                    });
                }
                where.OR = [
                    { branch: { in: staffScopeService.getRawAliasesForCanonicals([requestedCanon]) } },
                    { branch: 'ALL' }
                ];
            } else {
                where.OR = [
                    { branch: { in: rawAliases } },
                    { branch: 'ALL' }
                ];
            }
        } else if (req.query.branch && req.query.branch !== 'ALL') {
            const canon = staffScopeService.canonicalizeBranch(req.query.branch);
            const aliases = staffScopeService.getRawAliasesForCanonicals([canon]);
            where.branch = { in: aliases };
        }

        const achievements = await prisma.achievement.findMany({
            where,
            orderBy: { achievementDate: 'desc' }
        });

        res.json(achievements);
    } catch (e) {
        next(e);
    }
}

/**
 * Admin CREATE Achievement:
 * - HOD: Must target only their authorized department. Branch sent by frontend is validated against StaffScope!
 */
async function createAchievement(req, res, next) {
    try {
        const admin = req.admin;
        if (!admin) return res.status(401).json({ error: 'Admin session required' });

        const body = (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) ? req.body : (req.query || {});
        const title = String(body.title || '').trim();
        const description = String(body.description || '').trim();
        const category = VALID_CATEGORIES.includes(body.category) ? body.category : 'Other';
        const participantName = body.participantName ? String(body.participantName).trim() : null;
        const achievementDate = body.achievementDate ? new Date(body.achievementDate) : new Date();
        const isPublished = body.isPublished !== undefined ? String(body.isPublished) === 'true' : true;

        if (!title) return res.status(400).json({ error: 'Title is required' });
        if (!description) return res.status(400).json({ error: 'Description is required' });

        let targetBranch;

        if (admin.role === 'HOD') {
            // SECURITY: Always derive branch from server-side authenticated HOD identity.
            // The frontend branch field is intentionally ignored for HOD users.
            // req.admin.department is set by adminAuth middleware from StaffScope.
            if (admin.department) {
                targetBranch = admin.department;
            } else {
                // Safety fallback: re-fetch from StaffScope if middleware didn't populate it
                const { canonicals } = await staffScopeService.getAuthorizedDepartments(admin);
                if (!canonicals.length) {
                    return res.status(403).json({
                        error: 'Forbidden: HOD has no authorized department scope. Contact the administrator.'
                    });
                }
                targetBranch = canonicals[0];
            }
        } else {
            targetBranch = String(body.branch || '').trim();
            if (!targetBranch) targetBranch = 'ALL';
            else targetBranch = staffScopeService.canonicalizeBranch(targetBranch);
        }


        let imageUrl = null;

        // Check if image buffer attached in request body
        if (Buffer.isBuffer(req.body) && req.body.length > 0) {
            const originalFileName = imageStorage.safeName(req.headers['x-file-name'] || 'achievement.jpg');
            const detectedMime = imageStorage.detectImageType(req.body);
            if (!detectedMime) {
                return res.status(400).json({ error: 'Invalid or unsupported image file format.' });
            }
            const saved = await imageStorage.saveImage(req.body, originalFileName);
            imageUrl = saved.imageUrl;
        } else if (body.imageUrl) {
            imageUrl = String(body.imageUrl).trim();
        }

        const achievement = await prisma.achievement.create({
            data: {
                title,
                description,
                imageUrl,
                achievementDate,
                category,
                branch: targetBranch,
                participantName,
                createdByAdminId: admin.id,
                createdByName: admin.name || admin.email,
                createdByRole: admin.role,
                isPublished
            }
        });

        logger.info(`[Achievement] Created achievement ID ${achievement.id} for branch ${targetBranch} by ${admin.email}`);
        res.status(201).json({ success: true, achievement });
    } catch (e) {
        next(e);
    }
}

/**
 * Admin UPDATE Achievement:
 * - HOD: Can only update achievements belonging to their authorized branch scopes. 403 on cross-dept attempt!
 */
async function updateAchievement(req, res, next) {
    try {
        const admin = req.admin;
        if (!admin) return res.status(401).json({ error: 'Admin session required' });

        const { id } = req.params;
        const existing = await prisma.achievement.findUnique({ where: { id } });
        if (!existing) return res.status(404).json({ error: 'Achievement not found' });

        if (admin.role === 'HOD') {
            const { canonicals } = await staffScopeService.getAuthorizedDepartments(admin);
            const existingCanon = staffScopeService.canonicalizeBranch(existing.branch);
            if (!canonicals.includes(existingCanon)) {
                return res.status(403).json({
                    error: `Forbidden: HOD '${admin.email}' is not authorized to edit achievement ID ${id} in branch '${existing.branch}'`
                });
            }
        }

        // When binary image body is sent, field metadata arrives via query params.
        // For plain JSON updates, req.body is the parsed object.
        const body = (req.body && Buffer.isBuffer(req.body))
            ? (req.query || {})
            : (req.body || {});

        const updateData = {};

        if (body.title !== undefined) updateData.title = String(body.title).trim();
        if (body.description !== undefined) updateData.description = String(body.description).trim();
        if (body.category !== undefined && VALID_CATEGORIES.includes(body.category)) updateData.category = body.category;
        if (body.participantName !== undefined) updateData.participantName = body.participantName ? String(body.participantName).trim() : null;
        if (body.achievementDate !== undefined) updateData.achievementDate = new Date(body.achievementDate);
        if (body.isPublished !== undefined) updateData.isPublished = String(body.isPublished) === 'true';

        if (body.branch !== undefined && admin.role !== 'HOD') {
            updateData.branch = staffScopeService.canonicalizeBranch(body.branch);
        }

        // Image upload handling
        if (Buffer.isBuffer(req.body) && req.body.length > 0) {
            const originalFileName = imageStorage.safeName(req.headers['x-file-name'] || 'achievement.jpg');
            const detectedMime = imageStorage.detectImageType(req.body);
            if (!detectedMime) {
                return res.status(400).json({ error: 'Invalid or unsupported image file format.' });
            }
            if (existing.imageUrl && existing.imageUrl.includes('/api/achievements/images/')) {
                const oldFileName = existing.imageUrl.split('/api/achievements/images/')[1];
                await imageStorage.remove(oldFileName);
            }
            const saved = await imageStorage.saveImage(req.body, originalFileName);
            updateData.imageUrl = saved.imageUrl;
        } else if (body.imageUrl !== undefined) {
            updateData.imageUrl = String(body.imageUrl).trim();
        }

        const updated = await prisma.achievement.update({
            where: { id },
            data: updateData
        });

        res.json({ success: true, achievement: updated });
    } catch (e) {
        next(e);
    }
}

/**
 * Admin DELETE Achievement:
 * - HOD: Can only delete achievements belonging to their authorized branch scopes. 403 on cross-dept attempt!
 */
async function deleteAchievement(req, res, next) {
    try {
        const admin = req.admin;
        if (!admin) return res.status(401).json({ error: 'Admin session required' });

        const { id } = req.params;
        const existing = await prisma.achievement.findUnique({ where: { id } });
        if (!existing) return res.status(404).json({ error: 'Achievement not found' });

        if (admin.role === 'HOD') {
            const { canonicals } = await staffScopeService.getAuthorizedDepartments(admin);
            const existingCanon = staffScopeService.canonicalizeBranch(existing.branch);
            if (!canonicals.includes(existingCanon)) {
                return res.status(403).json({
                    error: `Forbidden: HOD '${admin.email}' is not authorized to delete achievement ID ${id} in branch '${existing.branch}'`
                });
            }
        }

        if (existing.imageUrl && existing.imageUrl.includes('/api/achievements/images/')) {
            const oldFileName = existing.imageUrl.split('/api/achievements/images/')[1];
            await imageStorage.remove(oldFileName);
        }

        await prisma.achievement.delete({ where: { id } });
        res.json({ success: true, message: 'Achievement deleted successfully' });
    } catch (e) {
        next(e);
    }
}

/**
 * Student GET Achievements:
 * - Defaults to student's branch published achievements.
 * - Supports ?scope=ALL for all college published achievements.
 */
async function getStudentAchievements(req, res, next) {
    try {
        const student = await prisma.student.findUnique({ where: { id: req.user.id } });
        if (!student) return res.status(401).json({ error: 'Student session invalid' });

        const studentCanonBranch = staffScopeService.canonicalizeBranch(student.branch);
        const branchAliases = staffScopeService.getRawAliasesForCanonicals([studentCanonBranch]);

        const scope = String(req.query.scope || 'BRANCH').toUpperCase();
        const category = String(req.query.category || '').trim();
        const q = String(req.query.q || '').trim();

        const where = { isPublished: true };

        if (scope !== 'ALL') {
            where.OR = [
                { branch: 'ALL' },
                { branch: { in: branchAliases } },
                { branch: studentCanonBranch }
            ];
        }

        if (category && category !== 'ALL') {
            where.category = category;
        }

        if (q) {
            where.AND = [
                {
                    OR: [
                        { title: { contains: q, mode: 'insensitive' } },
                        { description: { contains: q, mode: 'insensitive' } },
                        { participantName: { contains: q, mode: 'insensitive' } }
                    ]
                }
            ];
        }

        const achievements = await prisma.achievement.findMany({
            where,
            orderBy: { achievementDate: 'desc' }
        });

        // Achievements are admin-deletable. Never serve a stale cached response —
        // deleted records must disappear from the APK immediately on next fetch.
        res.setHeader('Cache-Control', 'no-store');
        res.json({
            studentBranch: studentCanonBranch,
            scope,
            achievements
        });
    } catch (e) {
        next(e);
    }
}

/**
 * Serve Achievement Image File safely.
 */
async function serveImage(req, res, next) {
    try {
        const { fileName } = req.params;
        const filePath = imageStorage.resolve(fileName);

        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'Image not found' });
        }

        const ext = imageStorage.extension(fileName);
        const mimeTypes = {
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.gif': 'image/gif',
            '.webp': 'image/webp'
        };

        res.type(mimeTypes[ext] || 'image/jpeg');
        fs.createReadStream(filePath).on('error', next).pipe(res);
    } catch (e) {
        next(e);
    }
}

module.exports = {
    getAdminAchievements,
    createAchievement,
    updateAchievement,
    deleteAchievement,
    getStudentAchievements,
    serveImage
};
