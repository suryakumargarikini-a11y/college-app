'use strict';

const router = require('express').Router();
const { adminAuth } = require('../../middleware/adminAuth');
const staffCtrl = require('../../controllers/admin/staffManagementController');

/**
 * Super Admin strict authorization guard
 */
const requireSuperAdmin = (req, res, next) => {
    if (!req.admin) {
        return res.status(401).json({ error: 'Unauthorized: Authentication required' });
    }
    if (req.admin.role !== 'SUPER_ADMIN') {
        return res.status(403).json({ error: 'Forbidden: Super Admin privileges required for staff management' });
    }
    next();
};

router.use(adminAuth);
router.use(requireSuperAdmin);

router.get('/',                       staffCtrl.listStaff);
router.post('/',                      staffCtrl.createStaff);
router.put('/:id',                    staffCtrl.updateStaff);
router.post('/:id/reset-password',    staffCtrl.resetPassword);
router.delete('/:id',                 staffCtrl.deactivateStaff);

module.exports = router;
