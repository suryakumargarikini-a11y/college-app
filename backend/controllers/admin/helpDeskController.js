'use strict';
const prisma = require('../../services/dbService');
const logger = require('../../services/logger');
const { auditLogRepository } = require('../../repositories/index');

const getAll = async (req, res, next) => {
    try {
        const { status, category } = req.query;
        const where = {};
        if (status) where.status = status;
        if (category) where.category = category.toUpperCase();

        const tickets = await prisma.helpTicket.findMany({
            where,
            include: {
                student: {
                    select: {
                        name: true,
                        roll: true,
                        email: true
                    }
                }
            },
            orderBy: { updatedAt: 'desc' }
        });
        res.json(tickets);
    } catch (err) {
        logger.error(`[Admin HelpDesk] getAll error: ${err.message}`);
        res.status(500).json({ error: 'Failed to fetch tickets' });
    }
};

const updateStatus = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { status } = req.body;

        if (!status) {
            return res.status(400).json({ error: 'Status is required' });
        }

        const ticket = await prisma.helpTicket.update({
            where: { id },
            data: {
                status,
                updatedAt: new Date()
            }
        });

        logger.info(`[Admin HelpDesk] Updated status of ticket ${id} to ${status}`);

        // Notify student on status change
        try {
            const dateStr = new Date().toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
            await prisma.notification.create({
                data: {
                    studentId: ticket.studentId,
                    title: `Ticket Status Update: ${status}`,
                    message: `Your ticket ${ticket.ticketNumber} is now marked ${status}.`,
                    type: 'help_desk',
                    category: status === 'RESOLVED' ? 'success' : 'update',
                    date: dateStr
                }
            });

            const firebaseService = require('../../services/firebaseService');
            const tokens = await prisma.fcmToken.findMany({ where: { studentId: ticket.studentId } });
            if (tokens.length > 0) {
                await firebaseService.sendToTokens?.(
                    tokens.map(t => t.token),
                    `Ticket Status Update`,
                    `Your ticket ${ticket.ticketNumber} status has changed to ${status}.`
                ).catch(() => {});
            }
        } catch (_) {}

        res.json(ticket);
    } catch (err) {
        logger.error(`[Admin HelpDesk] updateStatus error: ${err.message}`);
        res.status(500).json({ error: 'Failed to update ticket status' });
    }
};

const reply = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { message } = req.body;

        if (!message || message.trim() === '') {
            return res.status(400).json({ error: 'Message is required' });
        }

        const ticket = await prisma.helpTicket.findUnique({
            where: { id },
            include: { student: true }
        });

        if (!ticket) {
            return res.status(404).json({ error: 'Ticket not found' });
        }

        const adminReply = await prisma.$transaction(async (tx) => {
            const newReply = await tx.ticketReply.create({
                data: {
                    ticketId: id,
                    message,
                    senderType: 'ADMIN',
                    senderId: req.admin.email,
                    senderName: req.admin.name || 'Help Desk Admin'
                }
            });

            await tx.helpTicket.update({
                where: { id },
                data: {
                    status: 'IN_PROGRESS',
                    updatedAt: new Date()
                }
            });

            return newReply;
        });

        logger.info(`[Admin HelpDesk] Admin ${req.admin.email} replied to ticket ${ticket.ticketNumber}`);

        // DB Notification and FCM Push to Student
        try {
            const dateStr = new Date().toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
            await prisma.notification.create({
                data: {
                    studentId: ticket.studentId,
                    title: 'Help Desk Reply',
                    message: `Support Admin replied: "${message.substring(0, 60)}${message.length > 60 ? '...' : ''}"`,
                    type: 'help_desk',
                    category: 'update',
                    date: dateStr
                }
            });

            const firebaseService = require('../../services/firebaseService');
            const tokens = await prisma.fcmToken.findMany({ where: { studentId: ticket.studentId } });
            if (tokens.length > 0) {
                await firebaseService.sendToTokens?.(
                    tokens.map(t => t.token),
                    `New Support Ticket Reply`,
                    `Support Admin replied to ticket ${ticket.ticketNumber}`
                ).catch(() => {});
            }
        } catch (_) {}

        res.status(201).json(adminReply);
    } catch (err) {
        logger.error(`[Admin HelpDesk] reply error: ${err.message}`);
        res.status(500).json({ error: 'Failed to create admin reply' });
    }
};

module.exports = { getAll, updateStatus, reply };
