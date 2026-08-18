'use strict';

const express = require('express');
const router = express.Router();
const c = require('../../controllers/achievementController');
const { adminAuth, authorizeRoles } = require('../../middleware/adminAuth');

// Requires adminAuth for all admin achievement endpoints
router.use(adminAuth);

// SUPER_ADMIN, HOD, DEAN, CI can list achievements
router.get('/', authorizeRoles('SUPER_ADMIN', 'HOD', 'DEAN', 'CI'), c.getAdminAchievements);

// SUPER_ADMIN and HOD can create achievements
// Content-type-aware body parsing: raw buffer for image uploads, JSON for metadata
router.post(
    '/',
    authorizeRoles('SUPER_ADMIN', 'HOD'),
    (req, res, next) => {
        const ct = (req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
        if (ct.startsWith('image/') || ct === 'application/octet-stream') {
            express.raw({ type: '*/*', limit: '10mb' })(req, res, next);
        } else {
            express.json({ limit: '10mb' })(req, res, next);
        }
    },
    c.createAchievement
);


// SUPER_ADMIN and HOD can update achievements
// Content-type-aware body parsing: raw buffer for image uploads, JSON for metadata
router.put(
    '/:id',
    authorizeRoles('SUPER_ADMIN', 'HOD'),
    (req, res, next) => {
        const ct = (req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
        if (ct.startsWith('image/') || ct === 'application/octet-stream') {
            express.raw({ type: '*/*', limit: '10mb' })(req, res, next);
        } else {
            express.json({ limit: '10mb' })(req, res, next);
        }
    },
    c.updateAchievement
);

// SUPER_ADMIN and HOD can delete achievements
router.delete(
    '/:id',
    authorizeRoles('SUPER_ADMIN', 'HOD'),
    c.deleteAchievement
);

module.exports = router;
