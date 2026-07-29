'use strict';

const express = require('express');
const router = express.Router();
const c = require('../controllers/achievementController');
const { requireAuth } = require('../middleware/auth');

// Public/authenticated image serving endpoint
router.get('/images/:fileName', c.serveImage);

// Student achievements listing (authenticated)
router.get('/', requireAuth, c.getStudentAchievements);

module.exports = router;
