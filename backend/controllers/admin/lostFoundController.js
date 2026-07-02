'use strict';
const prisma = require('../../services/dbService');
const logger = require('../../services/logger');
const { auditLogRepository } = require('../../repositories/index');

const getAll = async (req, res, next) => {
    try {
        const items = await prisma.lostFoundItem.findMany({
            include: {
                claims: {
                    include: {
                        student: {
                            select: {
                                name: true,
                                roll: true,
                                email: true
                            }
                        }
                    }
                }
            },
            orderBy: { createdAt: 'desc' }
        });
        res.json(items);
    } catch (err) {
        logger.error(`[Admin LostFound] getAll error: ${err.message}`);
        res.status(500).json({ error: 'Failed to fetch items' });
    }
};

const verifyClaim = async (req, res, next) => {
    try {
        const { id, claimId } = req.params; // id = itemId

        const claim = await prisma.lostFoundClaim.findUnique({
            where: { id: claimId },
            include: {
                student: true,
                item: true
            }
        });

        if (!claim || claim.itemId !== id) {
            return res.status(404).json({ error: 'Claim not found for this item' });
        }

        if (claim.status !== 'PENDING') {
            return res.status(400).json({ error: 'Claim is not in pending status' });
        }

        // Mark claim as VERIFIED
        const updatedClaim = await prisma.lostFoundClaim.update({
            where: { id: claimId },
            data: { status: 'VERIFIED' }
        });

        logger.info(`[Admin LostFound] Verified claim ${claimId} on item ${id} by admin ${req.admin.email}`);

        // Notify claimant (student who claimed it)
        try {
            const dateStr = new Date().toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
            await prisma.notification.create({
                data: {
                    studentId: claim.studentId,
                    title: 'Claim Verified by Admin',
                    message: `Admin verified your claim for "${claim.item.title}". Awaiting owner confirmation.`,
                    type: 'lost_found',
                    category: 'success',
                    date: dateStr
                }
            });

            const firebaseService = require('../../services/firebaseService');
            const tokens = await prisma.fcmToken.findMany({ where: { studentId: claim.studentId } });
            if (tokens.length > 0) {
                await firebaseService.sendToTokens?.(
                    tokens.map(t => t.token),
                    'Claim Verified',
                    `Your claim for "${claim.item.title}" has been verified by the Admin.`
                ).catch(() => {});
            }
        } catch (_) {}

        // Notify owner (student who posted it) to confirm
        if (claim.item.studentId) {
            try {
                const dateStr = new Date().toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
                await prisma.notification.create({
                    data: {
                        studentId: claim.item.studentId,
                        title: 'Claim Verified: Action Required',
                        message: `Admin verified a claim on your item "${claim.item.title}". Please confirm to complete.`,
                        type: 'lost_found',
                        category: 'alert',
                        date: dateStr
                    }
                });

                const firebaseService = require('../../services/firebaseService');
                const tokens = await prisma.fcmToken.findMany({ where: { studentId: claim.item.studentId } });
                if (tokens.length > 0) {
                    await firebaseService.sendToTokens?.(
                        tokens.map(t => t.token),
                        'Action Required: Confirm Claim',
                        `Admin verified a claim on your item: ${claim.item.title}. Please confirm.`
                    ).catch(() => {});
                }
            } catch (_) {}
        }

        res.json(updatedClaim);
    } catch (err) {
        logger.error(`[Admin LostFound] verifyClaim error: ${err.message}`);
        res.status(500).json({ error: 'Failed to verify claim' });
    }
};

const updateStatus = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { status } = req.body; // CLAIMED, CLOSED, ACTIVE

        if (!status) {
            return res.status(400).json({ error: 'Status is required' });
        }

        const item = await prisma.lostFoundItem.update({
            where: { id },
            data: {
                status,
                updatedAt: new Date()
            }
        });

        logger.info(`[Admin LostFound] Status updated for item ${id} to ${status}`);
        res.json(item);
    } catch (err) {
        logger.error(`[Admin LostFound] updateStatus error: ${err.message}`);
        res.status(500).json({ error: 'Failed to update item status' });
    }
};

module.exports = { getAll, verifyClaim, updateStatus };
