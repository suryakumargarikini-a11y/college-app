'use strict';
const router = require('express').Router();
const { getPublished } = require('../controllers/admin/placementsController');
const { requireAuth } = require('../middleware/auth');

router.get('/', requireAuth, getPublished);

module.exports = router;
