const express = require('express');
const router = express.Router();
const { login, logout, registerFcmToken, removeFcmToken } = require('../controllers/authController');
const { requireAuth } = require('../middleware/auth');
const loginQueue = require('../middleware/loginQueue');

// Idempotent auth middleware specifically for logout (RFC 7009 compliant).
// If a valid Authorization header and session exist, req.session, req.token, and req.user are attached.
// If the token is missing, expired, or invalid, execution still proceeds to the logout controller
// so it can return HTTP 200 OK without failing token validation or triggering 401 response loops.
const optionalAuthForLogout = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.split(' ')[1];
        try {
            const sessionManager = require('../services/sessionManager');
            const session = await sessionManager.getSessionAsync(token);
            if (session) {
                req.session = session;
                req.token = token;
                req.user = { id: session.studentId || session.userId, userId: session.userId };
            }
        } catch (_) {}
    }
    next();
};

// loginQueue sits above BrowserPool — limits simultaneous ERP logins to LOGIN_QUEUE_CONCURRENCY
// Overflow gets a clean 503 instead of a 60-second queue timeout
router.post('/login', loginQueue, login);
router.post('/logout', optionalAuthForLogout, logout);
router.post('/fcm-token', requireAuth, registerFcmToken);
router.delete('/fcm-token', requireAuth, removeFcmToken);

module.exports = router;


