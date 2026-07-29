'use strict';

const express = require('express');
const router = express.Router();
const c = require('../../controllers/achievementController');
const { adminAuth } = require('../../middleware/adminAuth');
const { authorizeRoles } = require('../../middleware/authorizeRoles');

// Requires adminAuth for all admin achievement endpoints
router.use(adminAuth);

// SUPER_ADMIN, HOD, DEAN, CI can list achievements
router.get('/', authorizeRoles('SUPER_ADMIN', 'HOD', 'DEAN', 'CI'), c.getAdminAchievements);

// SUPER_ADMIN and HOD can create achievements
router.post(
    '/',
    authorizeRoles('SUPER_ADMIN', 'HOD'),
    express.raw({ type: ['image/*', 'application/octet-stream'], limit: '10mb' }),
    c.createAchievement
);

// SUPER_ADMIN and HOD can update achievements
router.put(
    '/:id',
    authorizeRoles('SUPER_ADMIN', 'HOD'),
    express.json({ limit: '10mb' }),
    c.updateAchievement
);

// SUPER_ADMIN and HOD can delete achievements
router.delete(
    '/:id',
    authorizeRoles('SUPER_ADMIN', 'HOD'),
    c.deleteAchievement
);

module.exports = router;
