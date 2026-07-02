const express = require('express');
const router = express.Router();
const { getMyTickets, getTicketById, createTicket, addReply } = require('../controllers/helpDeskController');
const { requireAuth } = require('../middleware/auth');

router.get('/', requireAuth, getMyTickets);
router.post('/', requireAuth, createTicket);
router.get('/:id', requireAuth, getTicketById);
router.post('/:id/reply', requireAuth, addReply);

module.exports = router;
