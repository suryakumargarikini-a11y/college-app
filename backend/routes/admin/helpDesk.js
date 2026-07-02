'use strict';
const router = require('express').Router();
const { getAll, updateStatus, reply } = require('../../controllers/admin/helpDeskController');
const { adminAuth, authorizeRoles } = require('../../middleware/adminAuth');

router.get('/', adminAuth, authorizeRoles('SUPER_ADMIN'), getAll);
const patchRouter = router.patch || router.put; // Fallback in case patch is not direct
router.patch('/:id/status', adminAuth, authorizeRoles('SUPER_ADMIN'), updateStatus);
router.post('/:id/reply', adminAuth, authorizeRoles('SUPER_ADMIN'), reply);

module.exports = router;
