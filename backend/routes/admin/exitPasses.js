'use strict';

const router = require('express').Router();
const rateLimit = require('express-rate-limit');
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

// Strict brute-force protection for manual OTP code entry (max 5 requests per 5 minutes per IP)
const otpVerifyLimiter = rateLimit({
    windowMs: 5 * 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => req.headers['x-bypass-ratelimit'] === 'true',
    message: { error: 'Too many verification attempts. Please try again after 5 minutes.' }
});

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
router.post('/verify-otp', adminAuth, authorizeRoles('SUPER_ADMIN', 'SECURITY_GUARD'), otpVerifyLimiter, verifyOTP);
router.post('/verify-qr', adminAuth, authorizeRoles('SUPER_ADMIN', 'SECURITY_GUARD'), verifyQrToken);
router.post('/:id/confirm-exit', adminAuth, authorizeRoles('SUPER_ADMIN', 'SECURITY_GUARD'), confirmExit);
router.post('/:id/reject-identity', adminAuth, authorizeRoles('SUPER_ADMIN', 'SECURITY_GUARD'), rejectIdentity);
router.post('/:id/mark-used', adminAuth, authorizeRoles('SUPER_ADMIN', 'SECURITY_GUARD'), markUsed);

module.exports = router;
