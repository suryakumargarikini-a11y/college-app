'use strict';
const router = require('express').Router();
const { getAll, create, update, remove, getResponses } = require('../../controllers/admin/surveysController');
const { adminAuth, authorizeRoles } = require('../../middleware/adminAuth');

router.get('/', adminAuth, authorizeRoles('SUPER_ADMIN'), getAll);
router.post('/', adminAuth, authorizeRoles('SUPER_ADMIN'), create);
router.put('/:id', adminAuth, authorizeRoles('SUPER_ADMIN'), update);
router.delete('/:id', adminAuth, authorizeRoles('SUPER_ADMIN'), remove);
router.get('/:id/responses', adminAuth, authorizeRoles('SUPER_ADMIN'), getResponses);

module.exports = router;
