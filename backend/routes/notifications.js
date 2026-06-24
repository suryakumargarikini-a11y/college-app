const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const dataControllers = require('../controllers/dataControllers');

router.get('/', requireAuth, dataControllers.getNotifications);
router.get('/unread', requireAuth, dataControllers.getUnreadCount);
router.post('/read', requireAuth, dataControllers.markRead);
router.post('/read-all', requireAuth, dataControllers.markAllRead);
router.delete('/:id', requireAuth, dataControllers.deleteNotification);
router.get('/debug', requireAuth, dataControllers.getNotificationDebug);

module.exports = router;
