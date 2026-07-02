'use strict';
const prisma = require('../services/dbService');
const logger = require('../services/logger');

const ETA_MAP = {
    TECHNICAL: '6 Hours',
    ACADEMIC: '24 Hours',
    FEES: '48 Hours',
    HOSTEL: '24 Hours',
    GENERAL: '48 Hours'
};

// GET /api/help-desk
const getMyTickets = async (req, res, next) => {
    try {
        const studentId = req.user.id;
        const tickets = await prisma.helpTicket.findMany({
            where: { studentId },
            include: {
                _count: {
                    select: { replies: true }
                }
            },
            orderBy: { updatedAt: 'desc' }
        });
        res.status(200).json({ success: true, tickets });
    } catch (err) {
        logger.error(`[HelpDesk] getMyTickets error: ${err.message}`);
        next(err);
    }
};

// GET /api/help-desk/:id
const getTicketById = async (req, res, next) => {
    try {
        const { id } = req.params;
        const studentId = req.user.id;

        const ticket = await prisma.helpTicket.findUnique({
            where: { id },
            include: {
                replies: {
                    orderBy: { createdAt: 'asc' }
                }
            }
        });

        if (!ticket) {
            return res.status(404).json({ success: false, message: 'Ticket not found' });
        }

        // Validate ownership
        if (ticket.studentId !== studentId) {
            return res.status(403).json({ success: false, message: 'Unauthorized access to ticket' });
        }

        res.status(200).json({ success: true, ticket });
    } catch (err) {
        logger.error(`[HelpDesk] getTicketById error: ${err.message}`);
        next(err);
    }
};

// POST /api/help-desk
const createTicket = async (req, res, next) => {
    try {
        const studentId = req.user.id;
        const { subject, description, category, priority = 'NORMAL' } = req.body;

        if (!subject || !description || !category) {
            return res.status(400).json({ success: false, message: 'Subject, description, and category are required' });
        }

        const catKey = category.toUpperCase();
        const estimatedResponseTime = ETA_MAP[catKey] || '48 Hours';

        // Generate formatted ticket number (HD-YYYY-XXXXXX)
        const year = new Date().getFullYear();
        const count = await prisma.helpTicket.count();
        const index = String(count + 1).padStart(6, '0');
        const ticketNumber = `HD-${year}-${index}`;

        const ticket = await prisma.helpTicket.create({
            data: {
                studentId,
                ticketNumber,
                subject,
                description,
                category: catKey,
                priority,
                estimatedResponseTime,
                status: 'OPEN'
            }
        });

        logger.info(`[HelpDesk] Student ${studentId} raised ticket ${ticket.ticketNumber}`);

        res.status(201).json({
            success: true,
            message: `Ticket raised successfully. ETA: ${estimatedResponseTime}`,
            ticket
        });
    } catch (err) {
        logger.error(`[HelpDesk] createTicket error: ${err.message}`);
        next(err);
    }
};

// POST /api/help-desk/:id/reply
const addReply = async (req, res, next) => {
    try {
        const { id } = req.params;
        const studentId = req.user.id;
        const { message } = req.body;

        if (!message || message.trim() === '') {
            return res.status(400).json({ success: false, message: 'Message is required' });
        }

        const ticket = await prisma.helpTicket.findUnique({
            where: { id },
            include: { student: true }
        });

        if (!ticket) {
            return res.status(404).json({ success: false, message: 'Ticket not found' });
        }

        if (ticket.studentId !== studentId) {
            return res.status(403).json({ success: false, message: 'Unauthorized' });
        }

        if (ticket.status === 'CLOSED') {
            return res.status(400).json({ success: false, message: 'Ticket is closed' });
        }

        // Add reply and update ticket in transaction
        const reply = await prisma.$transaction(async (tx) => {
            const newReply = await tx.ticketReply.create({
                data: {
                    ticketId: id,
                    message,
                    senderType: 'STUDENT',
                    senderId: studentId,
                    senderName: ticket.student.name
                }
            });

            // Re-open ticket if it was resolved
            const newStatus = ticket.status === 'RESOLVED' ? 'IN_PROGRESS' : ticket.status;

            await tx.helpTicket.update({
                where: { id },
                data: {
                    status: newStatus,
                    updatedAt: new Date()
                }
            });

            return newReply;
        });

        res.status(201).json({ success: true, reply });
    } catch (err) {
        logger.error(`[HelpDesk] addReply error: ${err.message}`);
        next(err);
    }
};

module.exports = { getMyTickets, getTicketById, createTicket, addReply };
