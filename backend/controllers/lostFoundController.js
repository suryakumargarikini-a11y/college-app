'use strict';
const prisma = require('../services/dbService');
const logger = require('../services/logger');

// GET /api/lost-found
const getAll = async (req, res, next) => {
    try {
        const { type } = req.query;
        const where = {
            status: { not: 'CLOSED' }
        };
        if (type) where.type = type.toUpperCase();

        const items = await prisma.lostFoundItem.findMany({
            where,
            include: {
                claims: {
                    select: {
                        id: true,
                        studentId: true,
                        status: true,
                        message: true
                    }
                }
            },
            orderBy: { createdAt: 'desc' }
        });
        res.status(200).json({ success: true, items });
    } catch (err) {
        logger.error(`[LostFound] getAll error: ${err.message}`);
        next(err);
    }
};

// POST /api/lost-found
const create = async (req, res, next) => {
    try {
        const studentId = req.user.id;
        const { title, description, location, type, imageUrls } = req.body;

        if (!title || !description || !location || !type) {
            return res.status(400).json({ success: false, message: 'Title, description, location, and type are required' });
        }

        // Get student name for ownerName
        const student = await prisma.student.findUnique({ where: { id: studentId } });

        const item = await prisma.lostFoundItem.create({
            data: {
                studentId,
                title,
                description,
                location,
                type: type.toUpperCase(),
                imageUrls: imageUrls ? JSON.stringify(imageUrls) : '[]',
                ownerName: student.name,
                status: 'ACTIVE'
            }
        });

        logger.info(`[LostFound] Student ${studentId} posted ${item.type} item: ${item.title}`);
        res.status(201).json({ success: true, item });
    } catch (err) {
        logger.error(`[LostFound] create error: ${err.message}`);
        next(err);
    }
};

// POST /api/lost-found/:id/claim
const claimItem = async (req, res, next) => {
    try {
        const studentId = req.user.id;
        const { id } = req.params;
        const { message } = req.body;

        const item = await prisma.lostFoundItem.findUnique({
            where: { id }
        });

        if (!item) {
            return res.status(404).json({ success: false, message: 'Item not found' });
        }

        if (item.studentId === studentId) {
            return res.status(400).json({ success: false, message: 'You cannot claim your own item' });
        }

        if (item.status === 'CLAIMED' || item.status === 'CLOSED') {
            return res.status(400).json({ success: false, message: 'Item is already claimed or closed' });
        }

        // Create claim and update item status to CLAIM_REQUESTED
        const claim = await prisma.$transaction(async (tx) => {
            const newClaim = await tx.lostFoundClaim.create({
                data: {
                    itemId: id,
                    studentId,
                    message,
                    status: 'PENDING'
                }
            });

            await tx.lostFoundItem.update({
                where: { id },
                data: { status: 'CLAIM_REQUESTED' }
            });

            return newClaim;
        });

        logger.info(`[LostFound] Student ${studentId} claimed item ${id}`);

        // Notify the owner of the post
        if (item.studentId) {
            try {
                const dateStr = new Date().toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
                await prisma.notification.create({
                    data: {
                        studentId: item.studentId,
                        title: 'New Claim on Lost & Found Item',
                        message: `Someone submitted a claim request for "${item.title}".`,
                        type: 'lost_found',
                        category: 'alert',
                        date: dateStr
                    }
                });

                const firebaseService = require('../services/firebaseService');
                const tokens = await prisma.fcmToken.findMany({ where: { studentId: item.studentId } });
                if (tokens.length > 0) {
                    await firebaseService.sendToTokens?.(
                        tokens.map(t => t.token),
                        'Lost & Found Claim',
                        `Someone has claimed your posted item: ${item.title}`
                    ).catch(() => {});
                }
            } catch (_) {}
        }

        res.status(201).json({ success: true, claim });
    } catch (err) {
        logger.error(`[LostFound] claimItem error: ${err.message}`);
        next(err);
    }
};

// POST /api/lost-found/:id/confirm-claim
const confirmClaim = async (req, res, next) => {
    try {
        const studentId = req.user.id;
        const { id } = req.params; // Item ID
        const { claimId } = req.body;

        const item = await prisma.lostFoundItem.findUnique({
            where: { id },
            include: { claims: true }
        });

        if (!item) {
            return res.status(404).json({ success: false, message: 'Item not found' });
        }

        if (item.studentId !== studentId) {
            return res.status(403).json({ success: false, message: 'Only the item owner can confirm claims' });
        }

        const claim = item.claims.find(c => c.id === claimId);
        if (!claim) {
            return res.status(404).json({ success: false, message: 'Claim not found on this item' });
        }

        if (claim.status !== 'VERIFIED') {
            return res.status(400).json({ success: false, message: 'Claim must be verified by admin before confirmation' });
        }

        // Update claim to CONFIRMED and item to CLAIMED
        await prisma.$transaction(async (tx) => {
            await tx.lostFoundClaim.update({
                where: { id: claimId },
                data: { status: 'CONFIRMED' }
            });

            await tx.lostFoundItem.update({
                where: { id },
                data: { status: 'CLAIMED' }
            });

            // Reject all other claims on this item
            await tx.lostFoundClaim.updateMany({
                where: {
                    itemId: id,
                    id: { not: claimId }
                },
                data: { status: 'REJECTED' }
            });
        });

        // Notify claimant
        try {
            const dateStr = new Date().toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
            await prisma.notification.create({
                data: {
                    studentId: claim.studentId,
                    title: 'Claim Confirmed!',
                    message: `Owner confirmed your claim for "${item.title}". Item has been marked returned.`,
                    type: 'lost_found',
                    category: 'success',
                    date: dateStr
                }
            });

            const firebaseService = require('../services/firebaseService');
            const tokens = await prisma.fcmToken.findMany({ where: { studentId: claim.studentId } });
            if (tokens.length > 0) {
                await firebaseService.sendToTokens?.(
                    tokens.map(t => t.token),
                    'Claim Confirmed',
                    `Your claim for "${item.title}" has been confirmed by the owner.`
                ).catch(() => {});
            }
        } catch (_) {}

        res.status(200).json({ success: true, message: 'Claim confirmed and item marked returned.' });
    } catch (err) {
        logger.error(`[LostFound] confirmClaim error: ${err.message}`);
        next(err);
    }
};

// DELETE /api/lost-found/:id
const remove = async (req, res, next) => {
    try {
        const studentId = req.user.id;
        const { id } = req.params;

        const item = await prisma.lostFoundItem.findUnique({ where: { id } });
        if (!item) {
            return res.status(404).json({ success: false, message: 'Item not found' });
        }

        if (item.studentId !== studentId) {
            return res.status(403).json({ success: false, message: 'Unauthorized to delete this item' });
        }

        await prisma.lostFoundItem.delete({ where: { id } });
        res.status(200).json({ success: true, message: 'Item deleted successfully' });
    } catch (err) {
        logger.error(`[LostFound] remove error: ${err.message}`);
        next(err);
    }
};

module.exports = { getAll, create, claimItem, confirmClaim, remove };
