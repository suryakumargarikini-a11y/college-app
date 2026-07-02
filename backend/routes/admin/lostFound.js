'use strict';
const router = require('express').Router();
const { getAll, verifyClaim, updateStatus } = require('../../controllers/admin/lostFoundController');
const { adminAuth, authorizeRoles } = require('../../middleware/adminAuth');

router.get('/', adminAuth, authorizeRoles('SUPER_ADMIN'), getAll);
router.patch('/:id/claim/:claimId', adminAuth, authorizeRoles('SUPER_ADMIN'), verifyClaim);
router.patch('/:id/status', adminAuth, authorizeRoles('SUPER_ADMIN'), updateStatus);

module.exports = router;
