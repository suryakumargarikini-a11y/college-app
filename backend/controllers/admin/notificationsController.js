'use strict';
const prisma = require('../../services/dbService');
const logger = require('../../services/logger');

const sendNotification = async (req, res) => {
    try {
        const { 
            title, 
            message, 
            targetAudience = 'ALL', 
            targetBranches, 
            targetYears, 
            targetSections, 
            quickFilter = 'NONE', 
            priority = 'NORMAL' 
        } = req.body;

        if (!title || !message) return res.status(400).json({ error: 'Title and message are required' });

        // Build database filtering criteria
        const studentFilter = {};

        if (targetAudience === 'FILTERED') {
            if (targetBranches && Array.isArray(targetBranches) && targetBranches.length > 0) {
                studentFilter.branch = { in: targetBranches };
            }
            
            const yearsToTarget = [];
            if (targetYears && Array.isArray(targetYears) && targetYears.length > 0) {
                yearsToTarget.push(...targetYears);
            }
            
            if (quickFilter === 'FIRST_YEAR') {
                yearsToTarget.push("Year 1", "1st Year", "1");
            } else if (quickFilter === 'FINAL_YEAR') {
                yearsToTarget.push("Year 4", "4th Year", "4");
            }

            if (yearsToTarget.length > 0) {
                studentFilter.year = { in: yearsToTarget };
            }

            if (targetSections && Array.isArray(targetSections) && targetSections.length > 0) {
                studentFilter.section = { in: targetSections };
            }
        }

        // Retrieve tokens matching the criteria
        const tokenRecords = await prisma.fcmToken.findMany({
            where: {
                student: studentFilter
            },
            select: { token: true }
        });

        const tokens = tokenRecords.map(t => t.token);

        let sent = 0;
        if (tokens.length > 0) {
            try {
                const firebaseService = require('../../services/firebaseService');
                await firebaseService.sendToTokens?.(tokens, title, message);
                sent = tokens.length;
            } catch (e) {
                logger.warn('[Notifications] FCM send error:', e.message);
            }
        }

        // Persist notification record in the admin log
        await prisma.adminNotification.create({
            data: { 
                title, 
                message, 
                targetAudience, 
                targetBranches: targetBranches ? JSON.stringify(targetBranches) : null,
                targetYears: targetYears ? JSON.stringify(targetYears) : null,
                targetSections: targetSections ? JSON.stringify(targetSections) : null,
                priority, 
                sentBy: req.admin.email 
            }
        });

        logger.info(`[Notifications] Sent '${title}' to ${sent} devices by ${req.admin.email}`);
        res.json({ success: true, devicesNotified: sent });
    } catch (err) {
        logger.error('[Notifications] Send error:', err);
        res.status(500).json({ error: 'Failed to send notification' });
    }
};

const getHistory = async (req, res) => {
    try {
        const history = await prisma.adminNotification.findMany({
            orderBy: { sentAt: 'desc' },
            take: 100
        });
        res.json(history);
    } catch (err) { 
        res.status(500).json({ error: 'Failed to fetch notification history' }); 
    }
};

module.exports = { sendNotification, getHistory };
