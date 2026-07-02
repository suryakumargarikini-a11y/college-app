const express = require('express');
const router = express.Router();
const { getActive, getMyResponses, getById, submit } = require('../controllers/surveysController');
const { requireAuth } = require('../middleware/auth');

router.get('/', requireAuth, getActive);
router.get('/submitted', requireAuth, getMyResponses);
router.get('/:id', requireAuth, getById);
router.post('/:id/submit', requireAuth, submit);

module.exports = router;
