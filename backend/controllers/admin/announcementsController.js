'use strict';
const prisma = require('../../services/dbService');
const logger = require('../../services/logger');

const getAll = async (req, res) => {
    try {
        const announcements = await prisma.announcement.findMany({ orderBy: { createdAt: 'desc' } });
        res.json(announcements);
    } catch (err) { res.status(500).json({ error: 'Failed to fetch announcements' }); }
};

const create = async (req, res) => {
    try {
        const { title, description, priority = 'NORMAL', link, status = 'DRAFT' } = req.body;
        if (!title || !description) return res.status(400).json({ error: 'Title and description are required' });
        const announcement = await prisma.announcement.create({
            data: { title, description, priority, link: link || null, status }
        });
        logger.info(`[Announcements] Created: ${title} by admin ${req.admin.email}`);
        
        const { auditLogRepository } = require('../../repositories/index');
        await auditLogRepository.log(null, 'ANNOUNCEMENT_CREATED', `Announcement '${title}' created by admin ${req.admin.email}`, req.admin.id, 'INFO');

        res.status(201).json(announcement);
    } catch (err) { res.status(500).json({ error: 'Failed to create announcement' }); }
};

const update = async (req, res) => {
    try {
        const { id } = req.params;
        const { title, description, priority, link, status } = req.body;
        const announcement = await prisma.announcement.update({
            where: { id },
            data: {
                ...(title && { title }),
                ...(description && { description }),
                ...(priority && { priority }),
                ...(link !== undefined && { link }),
                ...(status && { status })
            }
        });
        res.json(announcement);
    } catch (err) { res.status(500).json({ error: 'Failed to update announcement' }); }
};

const remove = async (req, res) => {
    try {
        await prisma.announcement.delete({ where: { id: req.params.id } });
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Failed to delete announcement' }); }
};

// Student-facing: published only
const getPublished = async (req, res) => {
    try {
        const announcements = await prisma.announcement.findMany({
            where: { status: 'PUBLISHED' },
            orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }]
        });
        res.json({ announcements });
    } catch (err) { res.status(500).json({ error: 'Failed to fetch announcements' }); }
};

module.exports = { getAll, create, update, remove, getPublished };
