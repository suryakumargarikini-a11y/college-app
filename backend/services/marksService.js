/**
 * SITAM Smart ERP — Marks Service
 *
 * Thin service layer for marks/results data queries.
 * Queries the database (via repositories) and returns normalized MarksResult objects.
 * Does NOT trigger ERP sync — that is managed by syncService.
 */

'use strict';

const logger = require('./logger');
const cacheService = require('./cacheService');
const { studentRepository, markRepository } = require('../repositories');
const { MarksResult, MarkRecord } = require('../models/normalized');

class MarksService {
    /**
     * Get marks/results data for a student from the database.
     *
     * @param {string} userId
     * @returns {Promise<MarksResult>}
     */
    async getMarksForStudent(userId) {
        try {
            const cached = cacheService.get('marks', userId);
            if (cached) {
                logger.debug(`[MarksService] Cache hit for ${userId}`);
                return cached;
            }

            const student = await studentRepository.findByUserId(userId);
            if (!student) {
                logger.warn(`[MarksService] Student not found: ${userId}`);
                return new MarksResult({ subjects: [], cgpa: '--', sgpa: '--', percentage: '--' });
            }

            const rawMarks = await markRepository.getMarks(student.id);

            const subjects = (rawMarks || []).map(m => MarkRecord.create({
                subjectCode: m.subjectCode || m.name,
                subjectName: m.subjectName || m.subjectCode || m.name,
                grade:       m.grade,
                credits:     m.credits,
                type:        m.type,
                status:      m.status,
                updatedAt:   m.updatedAt
            }));

            const result = new MarksResult({
                subjects,
                cgpa:       student.cgpa       || '--',
                sgpa:       student.sgpa       || '--',
                percentage: student.percentage || '--'
            });

            cacheService.set('marks', userId, result, 5 * 60 * 1000);
            return result;
        } catch (err) {
            logger.error(`[MarksService] Error fetching marks for ${userId}: ${err.message}`);
            return new MarksResult({ subjects: [], cgpa: '--', sgpa: '--', percentage: '--' });
        }
    }
}

module.exports = new MarksService();
