'use strict';
const router = require('express').Router();
const { getPublished, saveToggle, getSaved } = require('../controllers/admin/placementsController');
const { requireAuth } = require('../middleware/auth');

router.get('/', requireAuth, getPublished);
router.get('/saved', requireAuth, getSaved);
router.post('/:id/save', requireAuth, saveToggle);

module.exports = router;
