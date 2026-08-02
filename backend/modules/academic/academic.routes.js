/**
 * Academic Module V2 - Express Router
 * 
 * Maps REST API routes under /api/v2/academic/
 */

const express = require('express');
const router = express.Router();
const { requireAuth } = require('../../middleware/auth');
const academicController = require('./academic.controller');

// GET /api/v2/academic/results - Complete academic history and summary
router.get('/results', requireAuth, (req, res) => academicController.getAcademicResults(req, res));

// Fallback alias GET /api/v2/academic/marks
router.get('/marks', requireAuth, (req, res) => academicController.getAcademicResults(req, res));

module.exports = router;
