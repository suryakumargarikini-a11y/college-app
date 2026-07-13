'use strict';
const router = require('express').Router();

router.use('/auth',          require('./auth'));
router.use('/dashboard',     require('./dashboard'));
router.use('/announcements', require('./announcements'));
router.use('/placements',    require('./placements'));
router.use('/fee-notices',   require('./feeNotices'));
router.use('/exit-passes',   require('./exitPasses'));
router.use('/notifications', require('./notifications'));
router.use('/settings',      require('./settings'));
router.use('/surveys',       require('./surveys'));
router.use('/help-desk',     require('./helpDesk'));
router.use('/lost-found',    require('./lostFound'));

// ── Phase 5: Specialized Analytics Endpoints ──────────────────────────────
router.use('/students',      require('./students'));
router.use('/analytics',     require('./analytics'));

module.exports = router;
