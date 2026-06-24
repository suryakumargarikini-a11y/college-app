'use strict';
const router = require('express').Router();
const { getSettings, updateSettings } = require('../../controllers/admin/settingsController');
const { adminAuth, authorizeRoles } = require('../../middleware/adminAuth');

router.get('/', adminAuth, authorizeRoles('SUPER_ADMIN'), getSettings);
router.post('/', adminAuth, authorizeRoles('SUPER_ADMIN'), updateSettings);

module.exports = router;
