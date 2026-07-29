'use strict';

const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const lmsController = require('../controllers/lmsController');

// Student LMS Routes
router.get('/', requireAuth, lmsController.getStudentLmsCourses);
router.get('/courses', requireAuth, lmsController.getStudentLmsCourses);
router.get('/materials', requireAuth, lmsController.getStudentMaterials);
router.get('/assignments', requireAuth, lmsController.getStudentAssignments);
router.post('/assignments/:id/submit', requireAuth, lmsController.submitAssignment);
router.get('/assignments/:id/my-submission', requireAuth, lmsController.getMySubmission);

module.exports = router;
