'use strict';

const router = require('express').Router();
const { 
    apply, 
    applyGroup, 
    getMyPasses, 
    getQrToken, 
    getMyQuota, 
    cancel 
} = require('../controllers/admin/exitPassesController');
const { requireAuth } = require('../middleware/auth');

// Apply for single or group exit passes
router.post('/', requireAuth, apply);
router.post('/group', requireAuth, applyGroup);

// Fetch history & check remaining semester quota
router.get('/my', requireAuth, getMyPasses);
router.get('/quota', requireAuth, getMyQuota);

// Cancel a pending request
router.post('/:id/cancel', requireAuth, cancel);

// Retrieve decrypted raw QR token for own active approved pass
router.get('/:id/qr-token', requireAuth, getQrToken);

module.exports = router;
