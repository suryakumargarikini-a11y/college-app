'use strict';
const router = require('express').Router();
const { getStats, getSecurityStats } = require('../../controllers/admin/dashboardController');
const { adminAuth, authorizeRoles } = require('../../middleware/adminAuth');

router.get('/stats', adminAuth, authorizeRoles('SUPER_ADMIN', 'ACCOUNTS_ADMIN', 'PLACEMENT_ADMIN', 'HOD', 'DEAN', 'CI'), getStats);
router.get('/security-stats', adminAuth, authorizeRoles('SUPER_ADMIN', 'SECURITY_GUARD'), getSecurityStats);

module.exports = router;
