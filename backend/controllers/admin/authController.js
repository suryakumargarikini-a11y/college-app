'use strict';
const crypto = require('crypto');
const prisma = require('../../services/dbService');
const { signToken } = require('../../middleware/adminAuth');
const logger = require('../../services/logger');
const { auditLogRepository } = require('../../repositories/index');
const staffScopeService = require('../../services/staffScopeService');

/**
 * Resolves the HOD's primary canonical department from StaffScope.
 * Returns null for non-HOD roles.
 */
async function resolveHodDepartment(adminRecord) {
    if (!adminRecord || adminRecord.role !== 'HOD') return null;
    try {
        const { canonicals } = await staffScopeService.getAuthorizedDepartments(adminRecord);
        return canonicals.length > 0 ? canonicals[0] : null;
    } catch (err) {
        logger.error(`[AuthController] Failed to resolve HOD department for ${adminRecord.id}: ${err.message}`);
        return null;
    }
}

// ── P0-4: Startup Guard — ADMIN_PASSWORD_SALT (used as HMAC pepper) ───────────
// Fail hard at module load if the pepper is absent, empty, or a known default.
// DO NOT rotate, rename, or migrate in Batch 1 — bcrypt migration is a separate phase.
// SECURITY: The pepper value is never logged — only its absence or invalidity.
const _ADMIN_SALT_KNOWN_DEFAULTS = new Set(['sitam-admin-salt']);
const _rawAdminSalt = process.env.ADMIN_PASSWORD_SALT;
if (!_rawAdminSalt || _rawAdminSalt.trim() === '') {
    console.error('[FATAL] ADMIN_PASSWORD_SALT environment variable is missing or empty. ' +
        'Set the pepper value in Railway → Variables before deploying. Server will not start.');
    throw new Error('ADMIN_PASSWORD_SALT must be configured before starting the server.');
}
if (_ADMIN_SALT_KNOWN_DEFAULTS.has(_rawAdminSalt)) {
    console.error('[FATAL] ADMIN_PASSWORD_SALT is set to a known public default value. ' +
        'Replace it with the configured pepper in Railway → Variables.');
    throw new Error('ADMIN_PASSWORD_SALT must not use a known default value.');
}
const SALT = _rawAdminSalt;
// ─────────────────────────────────────────────────────────────────────────────

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

        const token = signToken(admin);

        auditLogRepository.logAction({
            adminId: admin.id,
            action: 'ADMIN_LOGIN',
            resource: 'auth',
            details: { email: admin.email, role: admin.role },
            ipAddress: req.ip,
            userAgent: req.get('user-agent')
        }).catch(err => logger.error(`Failed to log admin login: ${err.message}`));

        // Resolve department for HOD users — sourced from StaffScope (not Admin model)
        const department = await resolveHodDepartment(admin);

        res.json({
            token,
            admin: {
                id: admin.id,
                email: admin.email,
                name: admin.name,
                role: admin.role,
                department // null for non-HOD; canonical dept string (e.g. "ECE") for HOD
            }
        });
    } catch (error) {
        logger.error(`Admin login error: ${error.message}`);
        res.status(500).json({ error: 'Internal server error' });
    }
};

const getMe = async (req, res) => {
    try {
        const admin = await prisma.admin.findUnique({
            where: { id: req.admin.id },
            select: { id: true, email: true, name: true, role: true, isActive: true }
        });
        if (!admin || !admin.isActive) return res.status(401).json({ error: 'Unauthorized' });

        // Include department for HOD roles
        const department = await resolveHodDepartment(admin);
        res.json({ admin: { ...admin, department } });
    } catch (error) {
        logger.error(`Admin getMe error: ${error.message}`);
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

        auditLogRepository.logAction({
            adminId: req.admin.id,
            action: 'PASSWORD_CHANGED',
            resource: 'auth',
            details: { email: req.admin.email },
            ipAddress: req.ip,
            userAgent: req.get('user-agent')
        }).catch(err => logger.error(`Failed to log password change: ${err.message}`));

        res.json({ success: true, message: 'Password changed successfully' });
    } catch (error) {
        logger.error(`Admin changePassword error: ${error.message}`);
        res.status(500).json({ error: 'Internal server error' });
    }
};

const logout = async (req, res) => {
    try {
        auditLogRepository.logAction({
            adminId: req.admin.id,
            action: 'ADMIN_LOGOUT',
            resource: 'auth',
            details: { email: req.admin.email },
            ipAddress: req.ip,
            userAgent: req.get('user-agent')
        }).catch(err => logger.error(`Failed to log admin logout: ${err.message}`));

        res.json({ success: true, message: 'Logged out successfully' });
    } catch (error) {
        logger.error(`Admin logout error: ${error.message}`);
        res.status(500).json({ error: 'Internal server error' });
    }
};

module.exports = { login, getMe, changePassword, logout, hashPassword };
