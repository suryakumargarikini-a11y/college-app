'use strict';
const router = require('express').Router();
const { getActive } = require('../controllers/admin/feeNoticesController');
const { requireAuth } = require('../middleware/auth');

router.get('/active', requireAuth, getActive);

module.exports = router;
