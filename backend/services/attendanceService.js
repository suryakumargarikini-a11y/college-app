/**
 * SITAM Smart ERP — Attendance Service
 *
 * Thin service layer for attendance data queries.
 * Queries the database (via repositories) and returns normalized AttendanceResult objects.
 * Does NOT trigger ERP sync — that is managed by syncService.
 *
 * Providers and sync infrastructure write to the DB; this service reads from it.
 */

'use strict';

const logger = require('./logger');
const cacheService = require('./cacheService');
const { studentRepository, attendanceRepository } = require('../repositories');
const { AttendanceResult, AttendanceRecord } = require('../models/normalized');

class AttendanceService {
    /**
     * Get attendance data for a student from the database.
     *
     * @param {string} userId
     * @returns {Promise<AttendanceResult>}
     */
    async getAttendanceForStudent(userId) {
        try {
            // Try cache first
            const cached = cacheService.get('attendance', userId);
            if (cached) {
                logger.debug(`[AttendanceService] Cache hit for ${userId}`);
                return cached;
            }

            const student = await studentRepository.findByUserId(userId);
            if (!student) {
                logger.warn(`[AttendanceService] Student not found: ${userId}`);
                return new AttendanceResult({ records: [], overallPercentage: '--' });
            }

            const rawAttendance = await attendanceRepository.getAttendance(student.id);

            // Map raw DB attendance records to normalized model objects
            const records = (rawAttendance || []).map(r => AttendanceRecord.create({
                subjectCode: r.subjectCode || r.name,
                subjectName: r.subjectName || r.subjectCode || r.name,
                held:        r.held || r.total,
                attended:    r.attended || r.present,
                percentage:  r.percentage,
                status:      r.status,
                updatedAt:   r.updatedAt
            }));

            // Compute overall percentage from subjects
            let overallPercentage = student.percentage || '--';
            if (!overallPercentage || overallPercentage === '--') {
                if (records.length > 0) {
                    const sum = records.reduce((acc, r) => acc + r.percentage, 0);
                    overallPercentage = (sum / records.length).toFixed(2) + '%';
                }
            }

            const result = new AttendanceResult({ records, overallPercentage });

            // Cache for 5 minutes
            cacheService.set('attendance', userId, result, 5 * 60 * 1000);

            return result;
        } catch (err) {
            logger.error(`[AttendanceService] Error fetching attendance for ${userId}: ${err.message}`);
            return new AttendanceResult({ records: [], overallPercentage: '--' });
        }
    }
}

module.exports = new AttendanceService();
