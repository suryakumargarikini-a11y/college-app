'use strict';
const router = require('express').Router();
const { getStudents, getStudentDetail } = require('../../controllers/admin/adminStudentsController');
const { adminAuth } = require('../../middleware/adminAuth');
const { requirePermission, PERMISSIONS } = require('../../middleware/permissions');

router.get('/',           adminAuth, requirePermission(PERMISSIONS.STUDENT_BASIC_READ), getStudents);
router.get('/:id/detail', adminAuth, requirePermission(PERMISSIONS.STUDENT_BASIC_READ), getStudentDetail);

module.exports = router;