/**
 * Academic Module V2 - PostgreSQL Prisma Repository Layer
 * 
 * Source of truth for student academic results in PostgreSQL.
 */

const prisma = require('../../services/dbService');
const logger = require('../../services/logger');

class AcademicRepository {
    /**
     * Persist Academic History DTO to PostgreSQL database via Prisma.
     * @param {string} userId - Student User ID / Roll Number
     * @param {import('./academic.types').AcademicHistoryDTO} payload 
     * @returns {Promise<boolean>}
     */
    async saveAcademicHistory(userId, payload) {
        if (!userId || !payload) return false;

        try {
            const student = await prisma.student.findUnique({ where: { userId } });
            if (student) {
                const updateData = {
                    academicHistory: payload
                };
                if (payload.overall && payload.overall.cgpa && payload.overall.cgpa !== '--') {
                    updateData.cgpa = payload.overall.cgpa;
                }
                if (payload.overall && payload.overall.sgpa && payload.overall.sgpa !== '--') {
                    updateData.sgpa = payload.overall.sgpa;
                }

                await prisma.student.update({
                    where: { userId },
                    data: updateData
                });

                logger.info(`[AcademicRepository] Saved ${payload.semesters ? payload.semesters.length : 0} semesters to PostgreSQL for student ${userId}`);
                return true;
            } else {
                logger.warn(`[AcademicRepository] Student ${userId} not found in DB for academic update`);
                return false;
            }
        } catch (err) {
            logger.error(`[AcademicRepository] Error saving academic history to PostgreSQL for ${userId}: ${err.message}`);
            return false;
        }
    }

    /**
     * Retrieve Academic History DTO directly from PostgreSQL database via Prisma.
     * @param {string} userId 
     * @returns {Promise<import('./academic.types').AcademicHistoryDTO|null>}
     */
    async getAcademicHistory(userId) {
        if (!userId) return null;

        try {
            const student = await prisma.student.findUnique({
                where: { userId },
                select: { academicHistory: true, cgpa: true, sgpa: true, percentage: true }
            });

            if (student && student.academicHistory) {
                const parsed = typeof student.academicHistory === 'string'
                    ? JSON.parse(student.academicHistory)
                    : student.academicHistory;

                if (parsed && Array.isArray(parsed.semesters) && parsed.semesters.length > 0) {
                    logger.info(`[AcademicRepository] Retrieved ${parsed.semesters.length} semesters from PostgreSQL for student ${userId}`);
                    return parsed;
                }
            }
        } catch (err) {
            logger.warn(`[AcademicRepository] PostgreSQL lookup note for student ${userId}: ${err.message}`);
        }

        return null;
    }
}

module.exports = new AcademicRepository();
