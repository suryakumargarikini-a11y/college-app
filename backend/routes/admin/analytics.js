'use strict';
const router = require('express').Router();
const { getAnalytics } = require('../../controllers/admin/adminAnalyticsController');
const { adminAuth, authorizeRoles } = require('../../middleware/adminAuth');
const ALL = ['SUPER_ADMIN', 'ACCOUNTS_ADMIN', 'PLACEMENT_ADMIN'];

router.get('/', adminAuth, authorizeRoles(...ALL), getAnalytics);

module.exports = router;
