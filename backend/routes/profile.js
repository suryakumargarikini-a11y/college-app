const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const dataControllers = require('../controllers/dataControllers');
const { servePhoto } = require('../services/photoService');

// GET /api/profile — full profile for the authenticated student
router.get('/', requireAuth, dataControllers.getProfile);

// GET /api/profile/photo/:userId — serve cached student photo (no auth, safe: userId is non-guessable roll number)
router.get('/photo/:userId', servePhoto);

module.exports = router;
