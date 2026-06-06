/**
 * SITAM Smart ERP — Official API Provider (Scaffold)
 *
 * This is the future provider to implement once SITAM releases
 * an official REST API. Implements the same ERPProvider interface,
 * so swapping from SITAMScraperProvider requires ZERO changes to
 * services, queues, or frontend code.
 *
 * USAGE:
 *   Set ERP_PROVIDER=official-api in .env when ready to activate.
 *   Implement each method stub below using the official API endpoints.
 *
 * Current Status: SCAFFOLD (all methods throw NotImplementedError)
 */

'use strict';

const ERPProvider = require('../interfaces/ERPProvider');
const logger      = require('../../services/logger');

class SITAMOfficialAPIProvider extends ERPProvider {
    get providerName() {
        return 'sitam-official-api';
    }

    constructor() {
        super();
        // TODO: Initialize API client with base URL and auth config
        // this.baseUrl = process.env.SITAM_API_BASE_URL;
        // this.apiKey  = process.env.SITAM_API_KEY;
        logger.info('[SITAMOfficialAPI] Provider initialized (scaffold mode — not yet implemented)');
    }

    async login(credentials) {
        // TODO: POST /api/v1/auth/login with { userId, password }
        // TODO: Return { sessionId, token, expiresAt, studentName }
        throw new Error('[SITAMOfficialAPI] Official API not yet available. Use scraper provider.');
    }

    async refreshSession(session) {
        // TODO: POST /api/v1/auth/refresh with { token }
        throw new Error('[SITAMOfficialAPI] refreshSession() not yet implemented');
    }

    async logout(studentId) {
        // TODO: POST /api/v1/auth/logout
        throw new Error('[SITAMOfficialAPI] logout() not yet implemented');
    }

    async getAttendance(studentId, options = {}) {
        // TODO: GET /api/v1/students/{studentId}/attendance
        // TODO: Map response to AttendanceResult model
        throw new Error('[SITAMOfficialAPI] getAttendance() not yet implemented');
    }

    async getMarks(studentId, options = {}) {
        // TODO: GET /api/v1/students/{studentId}/marks
        // TODO: Map response to MarksResult model
        throw new Error('[SITAMOfficialAPI] getMarks() not yet implemented');
    }

    async getSubjects(studentId, options = {}) {
        // TODO: GET /api/v1/students/{studentId}/subjects
        // TODO: Map response to SubjectRecord[]
        throw new Error('[SITAMOfficialAPI] getSubjects() not yet implemented');
    }

    async getTimetable(studentId, options = {}) {
        // TODO: GET /api/v1/students/{studentId}/timetable
        // TODO: Map response to TimetableRecord[]
        throw new Error('[SITAMOfficialAPI] getTimetable() not yet implemented');
    }

    async getAssignments(studentId, options = {}) {
        // TODO: GET /api/v1/students/{studentId}/assignments
        // TODO: Map response to AssignmentResult model
        throw new Error('[SITAMOfficialAPI] getAssignments() not yet implemented');
    }

    async getExams(studentId, options = {}) {
        // TODO: GET /api/v1/students/{studentId}/exams
        // TODO: Map response to ExamResult model
        throw new Error('[SITAMOfficialAPI] getExams() not yet implemented');
    }

    async getFees(studentId, options = {}) {
        // TODO: GET /api/v1/students/{studentId}/fees
        // TODO: Map response to FeeResult model
        throw new Error('[SITAMOfficialAPI] getFees() not yet implemented');
    }

    async getTransactions(studentId, options = {}) {
        // TODO: GET /api/v1/students/{studentId}/transactions
        // TODO: Map response to TransactionRecord[]
        throw new Error('[SITAMOfficialAPI] getTransactions() not yet implemented');
    }

    async getNotifications(studentId, options = {}) {
        // TODO: GET /api/v1/students/{studentId}/notifications
        throw new Error('[SITAMOfficialAPI] getNotifications() not yet implemented');
    }

    async getAnnouncements(studentId, options = {}) {
        // TODO: GET /api/v1/announcements
        throw new Error('[SITAMOfficialAPI] getAnnouncements() not yet implemented');
    }

    async syncStudent(userId, password) {
        // TODO: Parallel fetch all data modules using API endpoints
        // TODO: Aggregate into SyncResult model
        throw new Error('[SITAMOfficialAPI] syncStudent() not yet implemented. Official API provider not available.');
    }

    async syncIncremental(userId, password, session) {
        // TODO: Use existing auth token to fetch only changed data
        throw new Error('[SITAMOfficialAPI] syncIncremental() not yet implemented');
    }

    async checkERPHealth() {
        // TODO: GET /api/v1/health
        // TODO: Return { healthy, responseTimeMs, provider, details }
        try {
            const axios = require('axios');
            const baseUrl = process.env.SITAM_API_BASE_URL || 'https://sitams.org/erp/';
            const start   = Date.now();
            const resp    = await axios.head(baseUrl, { timeout: 8000 });
            return {
                healthy:       resp.status < 500,
                responseTimeMs: Date.now() - start,
                provider:      this.providerName,
                details:       { httpStatus: resp.status, note: 'Scaffold mode — using HTTP probe only' }
            };
        } catch (err) {
            return { healthy: false, responseTimeMs: 0, provider: this.providerName, details: { error: err.message } };
        }
    }

    async validateSession(studentId, session) {
        // TODO: POST /api/v1/auth/validate with { token }
        throw new Error('[SITAMOfficialAPI] validateSession() not yet implemented');
    }
}

module.exports = new SITAMOfficialAPIProvider();
