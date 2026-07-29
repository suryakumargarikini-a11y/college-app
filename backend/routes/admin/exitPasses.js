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
const { adminAuth } = require('../../middleware/adminAuth');
const { requirePermission, PERMISSIONS } = require('../../middleware/permissions');

// Listing exit passes (SUPER_ADMIN, FACULTY, SECURITY_GUARD, HOD, DEAN, CI, HOSTEL_WARDEN)
router.get('/',           adminAuth, requirePermission(PERMISSIONS.EXIT_PASS_READ), getAll);
router.get('/groups',     adminAuth, requirePermission(PERMISSIONS.EXIT_PASS_READ), getGroups);
router.get('/quota/:studentId', adminAuth, requirePermission(PERMISSIONS.EXIT_PASS_READ), getStudentQuotaForAdmin);

// Approvals & Rejections (SUPER_ADMIN, FACULTY, HOD, DEAN)
router.post('/:id/approve',        adminAuth, requirePermission(PERMISSIONS.EXIT_PASS_APPROVE), approve);
router.post('/:id/reject',         adminAuth, requirePermission(PERMISSIONS.EXIT_PASS_APPROVE), reject);
router.post('/group/:id/approve',  adminAuth, requirePermission(PERMISSIONS.EXIT_PASS_APPROVE), approveGroup);
router.post('/group/:id/reject',   adminAuth, requirePermission(PERMISSIONS.EXIT_PASS_APPROVE), rejectGroup);

// Verification and checkout at campus gate (SUPER_ADMIN, SECURITY_GUARD)
router.post('/verify-otp',         adminAuth, requirePermission(PERMISSIONS.EXIT_PASS_GATE_VERIFY), verifyOTP);
router.post('/verify-qr',          adminAuth, requirePermission(PERMISSIONS.EXIT_PASS_GATE_VERIFY), verifyQrToken);
router.post('/:id/confirm-exit',    adminAuth, requirePermission(PERMISSIONS.EXIT_PASS_GATE_VERIFY), confirmExit);
router.post('/:id/reject-identity', adminAuth, requirePermission(PERMISSIONS.EXIT_PASS_GATE_VERIFY), rejectIdentity);
router.post('/:id/mark-used',       adminAuth, requirePermission(PERMISSIONS.EXIT_PASS_GATE_VERIFY), markUsed);

module.exports = router;