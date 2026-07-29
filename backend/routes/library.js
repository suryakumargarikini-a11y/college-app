'use strict';
const express = require('express');
const router = express.Router();
const c = require('../controllers/libraryController');
const { requireAuth } = require('../middleware/auth');
const { adminAuth } = require('../middleware/adminAuth');
const { requirePermission, PERMISSIONS } = require('../middleware/permissions');

// Student E-Library routes
router.get('/materials', requireAuth, c.studentList);
router.get('/materials/:id/content', requireAuth, c.serve);

// Admin / Staff E-Library routes
router.get('/admin/materials', adminAuth, requirePermission(PERMISSIONS.LIBRARY_READ), c.adminList);

router.post(
    '/admin/materials',
    adminAuth,
    requirePermission(PERMISSIONS.LIBRARY_UPLOAD),
    express.raw({ type: '*/*', limit: process.env.LIBRARY_MAX_UPLOAD_BYTES || '25mb' }),
    c.upload
);

router.put('/admin/materials/:id', adminAuth, requirePermission(PERMISSIONS.LIBRARY_MANAGE_OWN), c.update);

router.put(
    '/admin/materials/:id/file',
    adminAuth,
    requirePermission(PERMISSIONS.LIBRARY_MANAGE_OWN),
    express.raw({ type: '*/*', limit: process.env.LIBRARY_MAX_UPLOAD_BYTES || '25mb' }),
    c.replaceFile
);

router.post('/admin/materials/:id/archive', adminAuth, requirePermission(PERMISSIONS.LIBRARY_MANAGE_OWN), c.archive);
router.delete('/admin/materials/:id', adminAuth, requirePermission(PERMISSIONS.LIBRARY_MANAGE_OWN), c.del);

module.exports = router;