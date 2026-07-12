const express = require('express');
const router = express.Router();
const { login, registerFcmToken, removeFcmToken } = require('../controllers/authController');
const { requireAuth } = require('../middleware/auth');
const loginQueue = require('../middleware/loginQueue');

// loginQueue sits above BrowserPool — limits simultaneous ERP logins to LOGIN_QUEUE_CONCURRENCY
// Overflow gets a clean 503 instead of a 60-second queue timeout
router.post('/login', loginQueue, login);
router.post('/fcm-token', requireAuth, registerFcmToken);
router.delete('/fcm-token', requireAuth, removeFcmToken);

module.exports = router;
