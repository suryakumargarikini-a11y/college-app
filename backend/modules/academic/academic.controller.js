/**
 * Academic Module V2 - REST API Controller
 * 
 * Centralized error handling, standardized response formatting, and performance timing.
 */

const academicService = require('./academic.service');
const logger = require('../../services/logger');

class AcademicController {
    /**
     * GET /api/v2/academic/results
     * Returns student's overall academic summary and all completed semester accordion cards.
     */
    async getAcademicResults(req, res) {
        const startTime = Date.now();
        const userId = (req.session && req.session.userId) || (req.user && req.user.userId) || req.query.userId || req.body.userId;

        if (!userId) {
            return res.status(400).json({
                success: false,
                message: 'User authentication session missing or invalid'
            });
        }

        try {
            const data = await academicService.getAcademicResults(userId);
            const executionTimeMs = Date.now() - startTime;

            logger.info(`[AcademicController] GET /api/v2/academic/results served for ${userId} (${data.semesters.length} semesters) in ${executionTimeMs}ms`);

            return res.json({
                success: true,
                message: 'Academic history results fetched successfully (V2)',
                data: {
                    cgpa: data.overall ? data.overall.cgpa : '--',
                    sgpa: data.overall ? data.overall.sgpa : '--',
                    percentage: data.overall ? data.overall.percentage : '--',
                    overall: data.overall,
                    semesters: data.semesters
                },
                timestamp: new Date().toISOString()
            });
        } catch (err) {
            logger.error(`[AcademicController] Error serving academic results for ${userId}: ${err.message}`, { stack: err.stack });
            return res.status(500).json({
                success: false,
                message: 'Failed to retrieve academic results',
                error: err.message
            });
        }
    }
}

module.exports = new AcademicController();
