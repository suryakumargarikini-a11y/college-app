'use strict';

const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { getLmsCourses } = require('../controllers/dataControllers');

// GET /api/lms
router.get('/', requireAuth, getLmsCourses);

module.exports = router;
