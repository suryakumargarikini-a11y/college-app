'use strict';
const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const { login, getMe, changePassword, logout } = require('../../controllers/admin/authController');
const { adminAuth } = require('../../middleware/adminAuth');

// Strict brute-force protection for admin login (max 10 attempts per 15 min per IP)
const adminLoginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many login attempts. Please try again after 15 minutes.' },
    skipSuccessfulRequests: true // Only count failed attempts
});

router.post('/login', adminLoginLimiter, login);
router.post('/logout', adminAuth, logout);
router.get('/me', adminAuth, getMe);
router.put('/change-password', adminAuth, changePassword);

module.exports = router;
