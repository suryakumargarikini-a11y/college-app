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

// ── Phase 5: Specialized Analytics Endpoints ──────────────────────────────
router.use('/students',      require('./students'));
router.use('/analytics',     require('./analytics'));
router.use('/staff',         require('./staff'));
router.use('/lms',           require('./lms'));
router.use('/achievements',  require('./achievements'));

module.exports = router;
