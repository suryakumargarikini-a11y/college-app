'use strict';
const router = require('express').Router();
const { apply, getMyPasses } = require('../controllers/admin/exitPassesController');
const { requireAuth } = require('../middleware/auth');

router.post('/', requireAuth, apply);
router.get('/my', requireAuth, getMyPasses);

module.exports = router;
