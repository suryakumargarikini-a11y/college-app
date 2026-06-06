const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const dataControllers = require('../controllers/dataControllers');

router.get('/', requireAuth, dataControllers.getFees);
router.post('/open-payment', requireAuth, dataControllers.openPaymentWindow);
router.get('/payment-redirect', dataControllers.paymentRedirect);

module.exports = router;
