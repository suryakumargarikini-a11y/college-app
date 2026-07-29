'use strict';
const router = require('express').Router();
const { getAnalytics } = require('../../controllers/admin/adminAnalyticsController');
const { adminAuth, authorizeRoles } = require('../../middleware/adminAuth');

// Institution-wide analytics visible to senior academic staff and administrators
const ANALYTICS_ROLES = [
    'SUPER_ADMIN',
    'ACCOUNTS_ADMIN',
    'PLACEMENT_ADMIN',
    'HOD',    // Department head – needs attendance, marks, LMS analytics for their dept pages
    'DEAN',   // Academic oversight – institution-wide visibility is intentional
    'CI',     // College admin head – full analytics access
];

router.get('/', adminAuth, authorizeRoles(...ANALYTICS_ROLES), getAnalytics);

module.exports = router;
