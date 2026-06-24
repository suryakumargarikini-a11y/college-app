'use strict';
const router = require('express').Router();
const { sendNotification, getHistory } = require('../../controllers/admin/notificationsController');
const { adminAuth, authorizeRoles } = require('../../middleware/adminAuth');

router.post('/send', adminAuth, authorizeRoles('SUPER_ADMIN', 'PLACEMENT_ADMIN'), sendNotification);
router.get('/history', adminAuth, authorizeRoles('SUPER_ADMIN', 'PLACEMENT_ADMIN'), getHistory);

module.exports = router;
