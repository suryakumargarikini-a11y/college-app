/**
 * Academic Module V2 - Core Service Layer & Orchestrator
 * 
 * Implements business logic, caching strategy, database synchronization, and fallback mappers.
 */

const academicParser = require('./academic.parser');
const academicRepository = require('./academic.repository');
const academicCache = require('./academic.cache');
const demoProvider = require('../../adapters/demoProvider');
const logger = require('../../services/logger');

class AcademicService {
    /**
     * Get complete academic history results for a student.
     * Strategy: Cache ──► PostgreSQL DB ──► Demo Adapter Fallback
     * 
     * @param {string} userId 
     * @returns {Promise<import('./academic.types').AcademicHistoryDTO>}
     */
    async getAcademicResults(userId) {
        if (!userId) {
            throw new Error('UserId is required');
        }

        // 1. Check High-Performance Cache Layer
        const cached = await academicCache.get(userId);
        if (cached && Array.isArray(cached.semesters) && cached.semesters.length > 0) {
            return cached;
        }

        // 2. Primary Source of Truth: PostgreSQL Database Query via Prisma
        const dbData = await academicRepository.getAcademicHistory(userId);
        if (dbData && Array.isArray(dbData.semesters) && dbData.semesters.length > 0) {
            // Re-hydrate Cache
            await academicCache.set(userId, dbData);
            return dbData;
        }

        // 3. Fallback: Demo Provider ONLY when DEMO_MODE=true
        if ((process.env.DEMO_MODE || '').toLowerCase() === 'true') {
            try {
                const demoRes = await demoProvider.getMarks(userId);
                if (demoRes && Array.isArray(demoRes.semesters) && demoRes.semesters.length > 0) {
                    const demoPayload = {
                        overall: demoRes.overall || {
                            cgpa: demoRes.cgpa || '7.90',
                            sgpa: demoRes.sgpa || '8.13',
                            percentage: demoRes.percentage || '71.48%',
                            totalCredits: '127.5',
                            registeredCredits: '127.5',
                            status: 'PASS'
                        },
                        semesters: demoRes.semesters
                    };
                    await academicRepository.saveAcademicHistory(userId, demoPayload);
                    await academicCache.set(userId, demoPayload);
                    return demoPayload;
                }
            } catch (err) {
                logger.warn(`[AcademicService] Demo fallback note for ${userId}: ${err.message}`);
            }
        }

        // Default Empty Structure
        return {
            overall: {
                cgpa: '--',
                sgpa: '--',
                percentage: '--',
                totalCredits: '--',
                registeredCredits: '--',
                status: 'PASS'
            },
            semesters: []
        };
    }

    /**
     * Process fresh SITAM ECAP ERP HTML, parse into DTO, persist to PostgreSQL, and update Cache.
     * 
     * @param {string} userId 
     * @param {string} erpHtml 
     * @returns {Promise<import('./academic.types').AcademicHistoryDTO>}
     */
    async syncAcademicData(userId, erpHtml) {
        if (!userId || !erpHtml) {
            throw new Error('UserId and erpHtml are required for sync');
        }

        logger.info(`[AcademicService] Syncing fresh ERP academic data for student ${userId}`);
        const parsedData = academicParser.parse(erpHtml);

        if (parsedData && Array.isArray(parsedData.semesters) && parsedData.semesters.length > 0) {
            // 1. Persist to PostgreSQL Database
            await academicRepository.saveAcademicHistory(userId, parsedData);

            // 2. Update Cache
            await academicCache.set(userId, parsedData);
        } else {
            logger.warn(`[AcademicService] Parser returned empty semesters for student ${userId}`);
        }

        return parsedData;
    }
}

module.exports = new AcademicService();
