'use strict';
const prisma = require('../../services/dbService');
const logger = require('../../services/logger');
const { auditLogRepository } = require('../../repositories/index');

const getAll = async (req, res) => {
    try {
        const notices = await prisma.feeNotice.findMany({ orderBy: { createdAt: 'desc' } });
        res.json(notices);
    } catch (err) { res.status(500).json({ error: 'Failed to fetch fee notices' }); }
};

const create = async (req, res) => {
    try {
        const {
            title, description, dueDate,
            targetBatch = 'ALL', priority = 'NORMAL',
            popupEnabled = true, notificationEnabled = true,
            hallTicketBlockWarning = false
        } = req.body;

        if (!title || !description || !dueDate) {
            return res.status(400).json({ error: 'Title, description, and due date are required' });
        }

        const notice = await prisma.feeNotice.create({
            data: { 
                title, 
                description, 
                dueDate, 
                targetBatch, 
                priority, 
                popupEnabled, 
                notificationEnabled, 
                hallTicketBlockWarning, 
                isActive: true 
            }
        });
        logger.info(`[FeeNotices] Created: ${title} by admin ${req.admin.email}`);

        // Log to AuditLogs
        await auditLogRepository.log(
            null,
            'FEE_NOTICE_CREATED',
            `Fee notice '${title}' created by admin ${req.admin.email}`,
            req.admin.id,
            'INFO'
        );

        res.status(201).json(notice);
    } catch (err) { res.status(500).json({ error: 'Failed to create fee notice' }); }
};

const update = async (req, res) => {
    try {
        const notice = await prisma.feeNotice.update({ where: { id: req.params.id }, data: req.body });
        res.json(notice);
    } catch (err) { res.status(500).json({ error: 'Failed to update fee notice' }); }
};

const remove = async (req, res) => {
    try {
        await prisma.feeNotice.delete({ where: { id: req.params.id } });
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Failed to delete fee notice' }); }
};

// Student-facing: active notices within 15-day reminder window before due date
const getActive = async (req, res) => {
    try {
        const now = new Date();
        const notices = await prisma.feeNotice.findMany({ where: { isActive: true } });
        const reminderNotices = notices.filter(n => {
            if (!n.popupEnabled) return false;
            const due = new Date(n.dueDate);
            const daysUntilDue = Math.ceil((due - now) / (1000 * 60 * 60 * 24));
            return daysUntilDue >= 0 && daysUntilDue <= 15;
        });
        res.json({ notices: reminderNotices });
    } catch (err) { res.status(500).json({ error: 'Failed to fetch fee notices' }); }
};

module.exports = { getAll, create, update, remove, getActive };
