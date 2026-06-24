'use strict';
const crypto = require('crypto');
const prisma = require('../../services/dbService');
const { signToken } = require('../../middleware/adminAuth');
const logger = require('../../services/logger');
const { auditLogRepository } = require('../../repositories/index');

const SALT = process.env.ADMIN_PASSWORD_SALT || 'sitam-admin-salt';

function hashPassword(password) {
    return crypto.createHmac('sha256', SALT).update(password).digest('hex');
}

const login = async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });

        const admin = await prisma.admin.findUnique({ where: { email: email.toLowerCase().trim() } });
        if (!admin || !admin.isActive) return res.status(401).json({ error: 'Invalid credentials' });

        if (hashPassword(password) !== admin.passwordHash) {
            logger.warn(`[AdminAuth] Failed login for: ${email}`);
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const token = signToken({ id: admin.id, email: admin.email, name: admin.name, role: admin.role });
        logger.info(`[AdminAuth] Admin logged in: ${admin.email}`);
        
        // Log to AuditLogs
        await auditLogRepository.log(null, 'ADMIN_LOGIN', `Admin ${admin.email} signed in successfully`, admin.id, 'SECURITY');

        res.json({ token, admin: { id: admin.id, name: admin.name, email: admin.email, role: admin.role } });
    } catch (err) {
        logger.error('[AdminAuth] Login error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
};

const getMe = async (req, res) => {
    try {
        const admin = await prisma.admin.findUnique({
            where: { id: req.admin.id },
            select: { id: true, name: true, email: true, role: true, createdAt: true }
        });
        if (!admin) return res.status(404).json({ error: 'Admin not found' });
        res.json(admin);
    } catch (err) {
        res.status(500).json({ error: 'Internal server error' });
    }
};

const changePassword = async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;
        if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Both passwords required' });
        if (newPassword.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

        const admin = await prisma.admin.findUnique({ where: { id: req.admin.id } });
        if (hashPassword(currentPassword) !== admin.passwordHash) {
            return res.status(400).json({ error: 'Current password is incorrect' });
        }
        await prisma.admin.update({ where: { id: req.admin.id }, data: { passwordHash: hashPassword(newPassword) } });
        
        // Log to AuditLogs
        await auditLogRepository.log(null, 'PASSWORD_CHANGED', `Admin ${req.admin.email} changed password`, req.admin.id, 'SECURITY');

        res.json({ success: true, message: 'Password changed successfully' });
    } catch (err) {
        res.status(500).json({ error: 'Internal server error' });
    }
};

const logout = async (req, res) => {
    try {
        // Log to AuditLogs
        await auditLogRepository.log(null, 'ADMIN_LOGOUT', `Admin ${req.admin.email} signed out`, req.admin.id, 'INFO');
        res.json({ success: true, message: 'Logged out successfully' });
    } catch (err) {
        logger.error('[AdminAuth] Logout error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
};

module.exports = { login, getMe, changePassword, logout, hashPassword };
