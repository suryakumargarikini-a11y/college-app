'use strict';
const router = require('express').Router();
const { 
    sendNotification, 
    getHistory, 
    createNotification, 
    listNotifications, 
    getDetail, 
    editNotification, 
    deleteNotification, 
    publishNotification 
} = require('../../controllers/admin/notificationsController');
const { adminAuth, authorizeRoles } = require('../../middleware/adminAuth');

router.post('/send', adminAuth, authorizeRoles('SUPER_ADMIN', 'PLACEMENT_ADMIN'), sendNotification);
router.get('/history', adminAuth, authorizeRoles('SUPER_ADMIN', 'PLACEMENT_ADMIN'), getHistory);

// REST routes
router.post('/', adminAuth, authorizeRoles('SUPER_ADMIN', 'PLACEMENT_ADMIN'), createNotification);
router.get('/', adminAuth, authorizeRoles('SUPER_ADMIN', 'PLACEMENT_ADMIN'), listNotifications);
router.get('/:id', adminAuth, authorizeRoles('SUPER_ADMIN', 'PLACEMENT_ADMIN'), getDetail);
router.put('/:id', adminAuth, authorizeRoles('SUPER_ADMIN', 'PLACEMENT_ADMIN'), editNotification);
router.delete('/:id', adminAuth, authorizeRoles('SUPER_ADMIN', 'PLACEMENT_ADMIN'), deleteNotification);
router.post('/:id/publish', adminAuth, authorizeRoles('SUPER_ADMIN', 'PLACEMENT_ADMIN'), publishNotification);

module.exports = router;
