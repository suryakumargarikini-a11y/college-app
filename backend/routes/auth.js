const express = require('express');
const router = express.Router();
const { login, registerFcmToken, removeFcmToken } = require('../controllers/authController');
const { requireAuth } = require('../middleware/auth');

router.post('/login', login);
router.post('/fcm-token', requireAuth, registerFcmToken);
router.delete('/fcm-token', requireAuth, removeFcmToken);

module.exports = router;
