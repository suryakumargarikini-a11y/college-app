'use strict';
const router = require('express').Router();
const { getStudents, getStudentDetail } = require('../../controllers/admin/adminStudentsController');
const { adminAuth, authorizeRoles } = require('../../middleware/adminAuth');
const ALL = ['SUPER_ADMIN', 'ACCOUNTS_ADMIN', 'PLACEMENT_ADMIN'];

router.get('/',     adminAuth, authorizeRoles(...ALL), getStudents);
router.get('/:id/detail', adminAuth, authorizeRoles(...ALL), getStudentDetail);

module.exports = router;
