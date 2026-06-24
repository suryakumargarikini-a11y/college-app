'use strict';
const router = require('express').Router();
const { getAll, approve, reject, verifyOTP, markUsed } = require('../../controllers/admin/exitPassesController');
const { adminAuth, authorizeRoles } = require('../../middleware/adminAuth');

router.get('/', adminAuth, authorizeRoles('SUPER_ADMIN', 'SECURITY_GUARD'), getAll);
router.post('/:id/approve', adminAuth, authorizeRoles('SUPER_ADMIN'), approve);
router.post('/:id/reject', adminAuth, authorizeRoles('SUPER_ADMIN'), reject);
router.post('/verify-otp', adminAuth, authorizeRoles('SUPER_ADMIN', 'SECURITY_GUARD'), verifyOTP);
router.post('/:id/mark-used', adminAuth, authorizeRoles('SUPER_ADMIN', 'SECURITY_GUARD'), markUsed);

module.exports = router;
