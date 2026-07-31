const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const dataControllers = require('../controllers/dataControllers');

router.get('/', requireAuth, dataControllers.getMarks);
router.get('/results', requireAuth, dataControllers.getStudentResults);
module.exports = router;
