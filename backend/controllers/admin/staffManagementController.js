'use strict';

const prisma = require('../../services/dbService');
const logger = require('../../services/logger');
const { hashPassword } = require('./authController');
const { auditLogRepository } = require('../../repositories/index');

/**
 * Strict Server-Side Managed Roles Allowlist.
 * Staff Management API can ONLY provision or manage special staff roles.
 * Foundational system roles (SUPER_ADMIN, ACCOUNTS_ADMIN, SECURITY_GUARD, PLACEMENT_ADMIN)
 * are strictly protected and CANNOT be created or mutated through this API.
 */
const MANAGED_STAFF_ROLES = new Set([
    'HOD',
    'DEAN',
    'CI',
    'HOSTEL_WARDEN',
    'FACULTY'
]);

const FOUNDATIONAL_PROTECTED_ROLES = new Set([
    'SUPER_ADMIN',
    'ACCOUNTS_ADMIN',
    'SECURITY_GUARD',
    'PLACEMENT_ADMIN'
]);

const VALID_CANONICAL_DEPARTMENTS = new Set([
    'AIML', 'AIDS', 'ECE', 'IT', 'MECH', 'CIVIL', 'EEE', 'MBA', 'POLYTECHNIC'
]);

/**
 * Helper to format admin response without sensitive hash data
 */
function formatAdminResponse(admin) {
    const { passwordHash, ...safeAdmin } = admin;
    return safeAdmin;
}

/**
 * List all staff accounts
 */
const listStaff = async (req, res) => {
    try {
        const staff = await prisma.admin.findMany({
            include: {
                staffScopes: true
            },
            orderBy: { createdAt: 'desc' }
        });

        const sanitized = staff.map(formatAdminResponse);
        res.json({ success: true, count: sanitized.length, staff: sanitized });
    } catch (error) {
        logger.error(`[StaffMgmt] List error: ${error.message}`);
        res.status(500).json({ error: 'Failed to retrieve staff accounts' });
    }
};

/**
 * Create a new special staff account with atomic StaffScope creation
 */
const createStaff = async (req, res) => {
    try {
        // Mass assignment prevention: explicit field extraction
        const { email, name, role, initialPassword, departmentScopes } = req.body;

        if (!email || !name || !role || !initialPassword) {
            return res.status(400).json({ error: 'Name, email, role, and initial password are required' });
        }

        const cleanEmail = String(email).toLowerCase().trim();
        const cleanName = String(name).trim();

        // 1. Role validation & Super Admin / Foundational creation block
        if (FOUNDATIONAL_PROTECTED_ROLES.has(role)) {
            logger.warn(`[StaffMgmt] Privilege escalation attempt: Admin ${req.admin.email} tried to create role '${role}'`);
            return res.status(400).json({ error: `Creation of role '${role}' is strictly prohibited via Staff Management API` });
        }

        if (!MANAGED_STAFF_ROLES.has(role)) {
            return res.status(400).json({ error: `Invalid staff role '${role}'. Allowed roles: ${Array.from(MANAGED_STAFF_ROLES).join(', ')}` });
        }

        if (String(initialPassword).length < 8) {
            return res.status(400).json({ error: 'Password must be at least 8 characters long' });
        }

        // 2. Department Scope parsing & validation
        let scopeValues = [];
        if (Array.isArray(departmentScopes)) {
            scopeValues = departmentScopes.map(s => String(s).trim().toUpperCase()).filter(Boolean);
        } else if (typeof departmentScopes === 'string' && departmentScopes.trim()) {
            scopeValues = [departmentScopes.trim().toUpperCase()];
        }

        // HOD requirement validation
        if (role === 'HOD' && scopeValues.length === 0) {
            return res.status(400).json({ error: 'At least one valid department scope is required for HOD role' });
        }

        // Hostel Warden restriction: Warden must NOT have department scopes
        if (role === 'HOSTEL_WARDEN' && scopeValues.length > 0) {
            return res.status(400).json({ error: 'Hostel Warden role must not be assigned department scopes' });
        }

        // Validate department scopes against strict canonical set (no wildcards allowed)
        for (const sVal of scopeValues) {
            if (!VALID_CANONICAL_DEPARTMENTS.has(sVal)) {
                return res.status(400).json({ error: `Invalid department scope '${sVal}'. Valid scopes: ${Array.from(VALID_CANONICAL_DEPARTMENTS).join(', ')}` });
            }
        }

        // 3. Duplicate email check
        const existing = await prisma.admin.findUnique({ where: { email: cleanEmail } });
        if (existing) {
            return res.status(400).json({ error: 'An account with this email already exists' });
        }

        const hashedPassword = hashPassword(initialPassword);

        // 4. Atomic Prisma transaction for Admin + StaffScope
        const createdAdmin = await prisma.$transaction(async (tx) => {
            const admin = await tx.admin.create({
                data: {
                    email: cleanEmail,
                    name: cleanName,
                    role,
                    passwordHash: hashedPassword,
                    isActive: true
                }
            });

            if (scopeValues.length > 0) {
                for (const sVal of scopeValues) {
                    await tx.staffScope.create({
                        data: {
                            adminId: admin.id,
                            scopeType: 'DEPARTMENT',
                            scopeValue: sVal
                        }
                    });
                }
            }

            return tx.admin.findUnique({
                where: { id: admin.id },
                include: { staffScopes: true }
            });
        });

        auditLogRepository.logAction({
            adminId: req.admin.id,
            action: 'STAFF_ACCOUNT_CREATED',
            resource: 'admin_management',
            details: { createdAdminId: createdAdmin.id, email: createdAdmin.email, role: createdAdmin.role, scopes: scopeValues },
            ipAddress: req.ip,
            userAgent: req.get('user-agent')
        }).catch(err => logger.error(`Failed to log staff creation: ${err.message}`));

        logger.info(`[StaffMgmt] Super Admin ${req.admin.email} created staff: ${cleanEmail} (${role})`);
        res.status(201).json({ success: true, staff: formatAdminResponse(createdAdmin) });
    } catch (error) {
        logger.error(`[StaffMgmt] Create error: ${error.message}`);
        res.status(500).json({ error: 'Failed to create staff account' });
    }
};

/**
 * Update staff account details & StaffScope
 */
const updateStaff = async (req, res) => {
    try {
        const { id } = req.params;
        const { name, email, role, isActive, departmentScopes } = req.body;

        const target = await prisma.admin.findUnique({ where: { id }, include: { staffScopes: true } });
        if (!target) {
            return res.status(404).json({ error: 'Staff account not found' });
        }

        // Foundational system account protection
        if (FOUNDATIONAL_PROTECTED_ROLES.has(target.role)) {
            return res.status(400).json({ error: `Foundational system account with role '${target.role}' cannot be modified via Staff Management API` });
        }

        const updateData = {};
        if (name && String(name).trim()) updateData.name = String(name).trim();
        
        if (email && String(email).trim()) {
            const cleanEmail = String(email).toLowerCase().trim();
            if (cleanEmail !== target.email) {
                const existing = await prisma.admin.findUnique({ where: { email: cleanEmail } });
                if (existing) return res.status(400).json({ error: 'Email already in use by another account' });
                updateData.email = cleanEmail;
            }
        }

        if (role) {
            if (FOUNDATIONAL_PROTECTED_ROLES.has(role)) {
                return res.status(400).json({ error: `Escalation to role '${role}' is strictly prohibited` });
            }
            if (!MANAGED_STAFF_ROLES.has(role)) {
                return res.status(400).json({ error: `Invalid role '${role}'` });
            }
            updateData.role = role;
        }

        if (typeof isActive === 'boolean') {
            updateData.isActive = isActive;
        }

        let scopeValues = null;
        if (departmentScopes !== undefined) {
            if (Array.isArray(departmentScopes)) {
                scopeValues = departmentScopes.map(s => String(s).trim().toUpperCase()).filter(Boolean);
            } else if (typeof departmentScopes === 'string' && departmentScopes.trim()) {
                scopeValues = [departmentScopes.trim().toUpperCase()];
            } else {
                scopeValues = [];
            }

            const effectiveRole = role || target.role;
            if (effectiveRole === 'HOD' && scopeValues.length === 0) {
                return res.status(400).json({ error: 'At least one department scope is required for HOD role' });
            }
            if (effectiveRole === 'HOSTEL_WARDEN' && scopeValues.length > 0) {
                return res.status(400).json({ error: 'Hostel Warden role must not be assigned department scopes' });
            }

            for (const sVal of scopeValues) {
                if (!VALID_CANONICAL_DEPARTMENTS.has(sVal)) {
                    return res.status(400).json({ error: `Invalid department scope '${sVal}'` });
                }
            }
        }

        // Atomic transaction update
        const updatedAdmin = await prisma.$transaction(async (tx) => {
            if (Object.keys(updateData).length > 0) {
                await tx.admin.update({ where: { id }, data: updateData });
            }

            if (scopeValues !== null) {
                await tx.staffScope.deleteMany({ where: { adminId: id } });
                for (const sVal of scopeValues) {
                    await tx.staffScope.create({
                        data: {
                            adminId: id,
                            scopeType: 'DEPARTMENT',
                            scopeValue: sVal
                        }
                    });
                }
            }

            return tx.admin.findUnique({ where: { id }, include: { staffScopes: true } });
        });

        auditLogRepository.logAction({
            adminId: req.admin.id,
            action: 'STAFF_ACCOUNT_UPDATED',
            resource: 'admin_management',
            details: { targetId: id, updatedFields: Object.keys(updateData), scopesUpdated: scopeValues !== null },
            ipAddress: req.ip,
            userAgent: req.get('user-agent')
        }).catch(err => logger.error(`Failed to log staff update: ${err.message}`));

        res.json({ success: true, staff: formatAdminResponse(updatedAdmin) });
    } catch (error) {
        logger.error(`[StaffMgmt] Update error: ${error.message}`);
        res.status(500).json({ error: 'Failed to update staff account' });
    }
};

/**
 * Reset staff account password
 */
const resetPassword = async (req, res) => {
    try {
        const { id } = req.params;
        const { newPassword } = req.body;

        if (!newPassword || String(newPassword).length < 8) {
            return res.status(400).json({ error: 'New password must be at least 8 characters long' });
        }

        const target = await prisma.admin.findUnique({ where: { id } });
        if (!target) return res.status(404).json({ error: 'Staff account not found' });

        if (FOUNDATIONAL_PROTECTED_ROLES.has(target.role)) {
            return res.status(400).json({ error: `Foundational account '${target.role}' password cannot be reset via Staff Management API` });
        }

        const hashedPassword = hashPassword(newPassword);
        await prisma.admin.update({
            where: { id },
            data: { passwordHash: hashedPassword }
        });

        auditLogRepository.logAction({
            adminId: req.admin.id,
            action: 'STAFF_PASSWORD_RESET',
            resource: 'admin_management',
            details: { targetAdminId: id, targetEmail: target.email },
            ipAddress: req.ip,
            userAgent: req.get('user-agent')
        }).catch(err => logger.error(`Failed to log password reset: ${err.message}`));

        logger.info(`[StaffMgmt] Super Admin ${req.admin.email} reset password for staff: ${target.email}`);
        res.json({ success: true, message: 'Password reset successfully' });
    } catch (error) {
        logger.error(`[StaffMgmt] Password reset error: ${error.message}`);
        res.status(500).json({ error: 'Failed to reset staff password' });
    }
};

/**
 * Soft-deactivate staff account (isActive = false / toggle)
 */
const deactivateStaff = async (req, res) => {
    try {
        const { id } = req.params;
        if (id === req.admin.id) {
            return res.status(400).json({ error: 'Super Admin cannot deactivate their own account' });
        }

        const target = await prisma.admin.findUnique({ where: { id } });
        if (!target) return res.status(404).json({ error: 'Staff account not found' });

        if (FOUNDATIONAL_PROTECTED_ROLES.has(target.role)) {
            return res.status(400).json({ error: `Foundational system account '${target.role}' cannot be deactivated via Staff Management API` });
        }

        const updated = await prisma.admin.update({
            where: { id },
            data: { isActive: !target.isActive },
            include: { staffScopes: true }
        });

        auditLogRepository.logAction({
            adminId: req.admin.id,
            action: updated.isActive ? 'STAFF_ACCOUNT_ACTIVATED' : 'STAFF_ACCOUNT_DEACTIVATED',
            resource: 'admin_management',
            details: { targetAdminId: id, email: target.email },
            ipAddress: req.ip,
            userAgent: req.get('user-agent')
        }).catch(err => logger.error(`Failed to log deactivation toggle: ${err.message}`));

        res.json({ success: true, staff: formatAdminResponse(updated) });
    } catch (error) {
        logger.error(`[StaffMgmt] Deactivate error: ${error.message}`);
        res.status(500).json({ error: 'Failed to toggle account status' });
    }
};

module.exports = {
    listStaff,
    createStaff,
    updateStaff,
    resetPassword,
    deactivateStaff
};
