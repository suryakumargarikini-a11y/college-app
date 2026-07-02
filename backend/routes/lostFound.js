const express = require('express');
const router = express.Router();
const { getAll, create, claimItem, confirmClaim, remove } = require('../controllers/lostFoundController');
const { requireAuth } = require('../middleware/auth');

router.get('/', requireAuth, getAll);
router.post('/', requireAuth, create);
router.post('/:id/claim', requireAuth, claimItem);
router.post('/:id/confirm-claim', requireAuth, confirmClaim);
router.delete('/:id', requireAuth, remove);

module.exports = router;
