'use strict';
const express = require('express');
const router = express.Router();
const lmsController = require('../../controllers/lmsController');
const { adminAuth, authorizeRoles } = require('../../middleware/adminAuth');

const LMS_READ_ROLES = ['SUPER_ADMIN', 'DEAN', 'CI', 'HOD', 'FACULTY'];
const LMS_WRITE_ROLES = ['SUPER_ADMIN', 'HOD', 'FACULTY'];

// Audience Options for Cascading Targeting Dropdowns
router.get('/audience-options', adminAuth, authorizeRoles(...LMS_READ_ROLES), lmsController.getAudienceOptions);

// Courses & Subjects
router.get('/courses', adminAuth, authorizeRoles(...LMS_READ_ROLES), lmsController.getAdminCourses);

// Study Materials
router.get('/materials', adminAuth, authorizeRoles(...LMS_READ_ROLES), lmsController.getAdminMaterials);
router.post('/materials', adminAuth, authorizeRoles(...LMS_WRITE_ROLES), lmsController.createStudyMaterial);
router.delete('/materials/:id', adminAuth, authorizeRoles(...LMS_WRITE_ROLES), lmsController.deleteStudyMaterial);

// Assignments
router.get('/assignments', adminAuth, authorizeRoles(...LMS_READ_ROLES), lmsController.getAdminAssignments);
router.post('/assignments', adminAuth, authorizeRoles(...LMS_WRITE_ROLES), lmsController.createAssignment);
router.get('/assignments/:id/submissions', adminAuth, authorizeRoles(...LMS_READ_ROLES), lmsController.getAssignmentSubmissions);

// Grading
router.post('/submissions/:id/grade', adminAuth, authorizeRoles(...LMS_WRITE_ROLES), lmsController.gradeSubmission);

module.exports = router;
