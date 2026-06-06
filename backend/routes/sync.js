const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const dataControllers = require('../controllers/dataControllers');

router.get('/', requireAuth, dataControllers.triggerSync);
router.post('/', requireAuth, dataControllers.triggerSync);

module.exports = router;
