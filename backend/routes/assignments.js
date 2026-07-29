const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const lmsController = require('../controllers/lmsController');

router.get('/', requireAuth, lmsController.getStudentAssignments);
module.exports = router;
