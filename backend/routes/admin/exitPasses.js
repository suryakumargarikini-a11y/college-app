'use strict';

const router = require('express').Router();
const { 
    getAll, 
    approve, 
    reject, 
    approveGroup, 
    rejectGroup, 
    verifyOTP,
    verifyQrToken, 
    markUsed, 
    confirmExit, 
    rejectIdentity,
    getGroups,
    getStudentQuotaForAdmin
} = require('../../controllers/admin/exitPassesController');
const { adminAuth, authorizeRoles } = require('../../middleware/adminAuth');

// Listing exit passes (admins, faculty, guards)
router.get('/', adminAuth, authorizeRoles('SUPER_ADMIN', 'FACULTY', 'SECURITY_GUARD'), getAll);
router.get('/groups', adminAuth, authorizeRoles('SUPER_ADMIN', 'FACULTY', 'SECURITY_GUARD'), getGroups);
router.get('/quota/:studentId', adminAuth, authorizeRoles('SUPER_ADMIN', 'FACULTY', 'SECURITY_GUARD'), getStudentQuotaForAdmin);

// Approvals & Rejections (admins and faculty)
router.post('/:id/approve', adminAuth, authorizeRoles('SUPER_ADMIN', 'FACULTY'), approve);
router.post('/:id/reject', adminAuth, authorizeRoles('SUPER_ADMIN', 'FACULTY'), reject);

router.post('/group/:id/approve', adminAuth, authorizeRoles('SUPER_ADMIN', 'FACULTY'), approveGroup);
router.post('/group/:id/reject', adminAuth, authorizeRoles('SUPER_ADMIN', 'FACULTY'), rejectGroup);

// Verification and checkout at campus gate (guards and super admins)
// NOTE: verify-otp is retained as a route but the handler returns 410 Gone.
//       This ensures old clients receive a clear error rather than 404.
router.post('/verify-otp', adminAuth, authorizeRoles('SUPER_ADMIN', 'SECURITY_GUARD'), verifyOTP);
router.post('/verify-qr', adminAuth, authorizeRoles('SUPER_ADMIN', 'SECURITY_GUARD'), verifyQrToken);
router.post('/:id/confirm-exit', adminAuth, authorizeRoles('SUPER_ADMIN', 'SECURITY_GUARD'), confirmExit);
router.post('/:id/reject-identity', adminAuth, authorizeRoles('SUPER_ADMIN', 'SECURITY_GUARD'), rejectIdentity);
// NOTE: mark-used is retained as a route but the handler returns 410 Gone.
router.post('/:id/mark-used', adminAuth, authorizeRoles('SUPER_ADMIN', 'SECURITY_GUARD'), markUsed);

module.exports = router;
