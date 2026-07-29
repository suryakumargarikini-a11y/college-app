'use strict';

/**
 * SITAM Smart ERP — Centralized RBAC Permissions Middleware
 * Defines granular permission constants and maps each role to explicit permission grants.
 */

const PERMISSIONS = Object.freeze({
    STUDENT_BASIC_READ:      'STUDENT_BASIC_READ',
    STUDENT_ACADEMIC_READ:   'STUDENT_ACADEMIC_READ',
    STUDENT_FULL_READ:       'STUDENT_FULL_READ',

    LIBRARY_UPLOAD:          'LIBRARY_UPLOAD',
    LIBRARY_READ:            'LIBRARY_READ',
    LIBRARY_TARGET_STUDENTS: 'LIBRARY_TARGET_STUDENTS',
    LIBRARY_MANAGE_OWN:      'LIBRARY_MANAGE_OWN',

    EXIT_PASS_READ:          'EXIT_PASS_READ',
    EXIT_PASS_APPROVE:       'EXIT_PASS_APPROVE',
    EXIT_PASS_GATE_VERIFY:   'EXIT_PASS_GATE_VERIFY',

    ADMINISTRATION_READ:     'ADMINISTRATION_READ'
});

const ROLE_PERMISSIONS = Object.freeze({
    SUPER_ADMIN: Object.values(PERMISSIONS),

    FACULTY: [
        PERMISSIONS.STUDENT_BASIC_READ,
        PERMISSIONS.STUDENT_ACADEMIC_READ,
        PERMISSIONS.LIBRARY_UPLOAD,
        PERMISSIONS.LIBRARY_READ,
        PERMISSIONS.LIBRARY_TARGET_STUDENTS,
        PERMISSIONS.LIBRARY_MANAGE_OWN,
        PERMISSIONS.EXIT_PASS_READ,
        PERMISSIONS.EXIT_PASS_APPROVE
    ],

    ACCOUNTS_ADMIN: [
        PERMISSIONS.STUDENT_BASIC_READ,
        PERMISSIONS.STUDENT_FULL_READ,
        PERMISSIONS.ADMINISTRATION_READ
    ],

    SECURITY_GUARD: [
        PERMISSIONS.STUDENT_BASIC_READ,
        PERMISSIONS.EXIT_PASS_READ,
        PERMISSIONS.EXIT_PASS_GATE_VERIFY
    ],

    HOD: [
        PERMISSIONS.STUDENT_BASIC_READ,
        PERMISSIONS.STUDENT_ACADEMIC_READ,
        PERMISSIONS.STUDENT_FULL_READ,
        PERMISSIONS.LIBRARY_UPLOAD,
        PERMISSIONS.LIBRARY_READ,
        PERMISSIONS.LIBRARY_TARGET_STUDENTS,
        PERMISSIONS.LIBRARY_MANAGE_OWN,
        PERMISSIONS.EXIT_PASS_READ,
        PERMISSIONS.EXIT_PASS_APPROVE
    ],

    DEAN: [
        PERMISSIONS.STUDENT_BASIC_READ,
        PERMISSIONS.STUDENT_ACADEMIC_READ,
        PERMISSIONS.STUDENT_FULL_READ,
        PERMISSIONS.LIBRARY_UPLOAD,
        PERMISSIONS.LIBRARY_READ,
        PERMISSIONS.LIBRARY_TARGET_STUDENTS,
        PERMISSIONS.LIBRARY_MANAGE_OWN,
        PERMISSIONS.EXIT_PASS_READ,
        PERMISSIONS.EXIT_PASS_APPROVE,
        PERMISSIONS.ADMINISTRATION_READ
    ],

    CI: [
        PERMISSIONS.STUDENT_BASIC_READ,
        PERMISSIONS.STUDENT_ACADEMIC_READ,
        PERMISSIONS.STUDENT_FULL_READ,
        PERMISSIONS.LIBRARY_READ,
        PERMISSIONS.EXIT_PASS_READ,
        PERMISSIONS.ADMINISTRATION_READ
    ],

    HOSTEL_WARDEN: [
        PERMISSIONS.STUDENT_BASIC_READ,
        PERMISSIONS.EXIT_PASS_READ
    ]
});

/**
 * Check if a role possesses a specific permission.
 */
function hasPermission(role, permission) {
    if (!role || !permission) return false;
    const permissions = ROLE_PERMISSIONS[role];
    if (!permissions) return false;
    return permissions.includes(permission);
}

/**
 * Express middleware requiring the authenticated user (req.admin or req.user)
 * to possess a specific permission.
 */
function requirePermission(permission) {
    return (req, res, next) => {
        const admin = req.admin || (req.session && req.session.isAdmin ? req.session : null);
        if (!admin || !admin.role) {
            return res.status(401).json({ error: 'Unauthorized: Authentication required' });
        }
        if (!hasPermission(admin.role, permission)) {
            return res.status(403).json({
                error: `Forbidden: Role '${admin.role}' lacks required permission '${permission}'`
            });
        }
        next();
    };
}

/**
 * Express middleware requiring the authenticated user to possess ALL specified permissions.
 */
function requirePermissions(...permissions) {
    return (req, res, next) => {
        const admin = req.admin || (req.session && req.session.isAdmin ? req.session : null);
        if (!admin || !admin.role) {
            return res.status(401).json({ error: 'Unauthorized: Authentication required' });
        }
        for (const perm of permissions) {
            if (!hasPermission(admin.role, perm)) {
                return res.status(403).json({
                    error: `Forbidden: Role '${admin.role}' lacks required permission '${perm}'`
                });
            }
        }
        next();
    };
}

module.exports = {
    PERMISSIONS,
    ROLE_PERMISSIONS,
    hasPermission,
    requirePermission,
    requirePermissions
};