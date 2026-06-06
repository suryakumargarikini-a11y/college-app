const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const dataControllers = require('../controllers/dataControllers');

router.get('/', requireAuth, dataControllers.getSyllabus);
router.post('/unit', requireAuth, dataControllers.toggleSyllabusUnit);

module.exports = router;
