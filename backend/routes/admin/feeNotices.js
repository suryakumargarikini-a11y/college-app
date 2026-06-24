'use strict';
const router = require('express').Router();
const { getAll, create, update, remove } = require('../../controllers/admin/feeNoticesController');
const { adminAuth, authorizeRoles } = require('../../middleware/adminAuth');

router.get('/', adminAuth, authorizeRoles('SUPER_ADMIN', 'ACCOUNTS_ADMIN'), getAll);
router.post('/', adminAuth, authorizeRoles('SUPER_ADMIN', 'ACCOUNTS_ADMIN'), create);
router.put('/:id', adminAuth, authorizeRoles('SUPER_ADMIN', 'ACCOUNTS_ADMIN'), update);
router.delete('/:id', adminAuth, authorizeRoles('SUPER_ADMIN', 'ACCOUNTS_ADMIN'), remove);

module.exports = router;
