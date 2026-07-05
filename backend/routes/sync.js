const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const dataControllers = require('../controllers/dataControllers');
const prisma = require('../services/dbService');

router.get('/debug', requireAuth, async (req, res) => {
    try {
        const logs = await prisma.auditLog.findMany({
            where: { studentId: req.user.id },
            orderBy: { timestamp: 'desc' },
            take: 20
        });
        res.json({ success: true, logs });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

router.get('/', requireAuth, dataControllers.triggerSync);
router.post('/', requireAuth, dataControllers.triggerSync);

module.exports = router;
