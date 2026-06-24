'use strict';
const router = require('express').Router();
const { getAll, create, update, remove } = require('../../controllers/admin/announcementsController');
const { adminAuth, authorizeRoles } = require('../../middleware/adminAuth');

router.get('/', adminAuth, authorizeRoles('SUPER_ADMIN', 'PLACEMENT_ADMIN'), getAll);
router.post('/', adminAuth, authorizeRoles('SUPER_ADMIN', 'PLACEMENT_ADMIN'), create);
router.put('/:id', adminAuth, authorizeRoles('SUPER_ADMIN', 'PLACEMENT_ADMIN'), update);
router.delete('/:id', adminAuth, authorizeRoles('SUPER_ADMIN', 'PLACEMENT_ADMIN'), remove);

module.exports = router;
