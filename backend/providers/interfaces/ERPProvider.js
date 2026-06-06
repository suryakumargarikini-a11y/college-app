/**
 * SITAM Smart ERP — ERPProvider Interface
 *
 * This is the canonical provider contract that ALL ERP integration providers
 * must implement. Whether we use Puppeteer scraping, official REST APIs, or
 * a test mock — the service layer always calls this interface.
 *
 * MIGRATION PATH:
 *   Today:  Service → SITAMScraperProvider (Puppeteer)
 *   Future: Service → SITAMOfficialAPIProvider (REST API)
 *
 * No changes to frontend, queues, or telemetry are required when switching
 * between providers — just swap ProviderFactory.getProvider() target.
 */

'use strict';

class ERPProvider {
    /**
     * Provider name — used in telemetry, logs, and metrics labelling.
     * Override in each concrete provider.
     * @type {string}
     */
    get providerName() {
        return 'abstract';
    }

    // ─── Authentication ─────────────────────────────────────────────────────────

    /**
     * Authenticate a student against the ERP system.
     *
     * @param {{ userId: string, password: string }} credentials
     * @returns {Promise<{ sessionId: string, cookies: string, expiresAt: Date, studentName: string }>}
     * @throws {AuthenticationError} Invalid credentials
     * @throws {ERPUnavailableError} ERP portal unreachable
     * @throws {CaptchaDetectedError} CAPTCHA wall detected
     */
    async login(credentials) {
        throw new Error(`[${this.providerName}] login() not implemented`);
    }

    /**
     * Refresh an existing session without full re-login.
     * Providers that support token refresh implement this for efficiency.
     *
     * @param {{ userId: string, cookies: string }} session
     * @returns {Promise<{ cookies: string, expiresAt: Date, refreshed: boolean }>}
     * @throws {SessionExpiredError} Session too stale to refresh; caller must re-login
     */
    async refreshSession(session) {
        throw new Error(`[${this.providerName}] refreshSession() not implemented`);
    }

    /**
     * Invalidate the student's active ERP session.
     *
     * @param {string} studentId
     * @returns {Promise<{ success: boolean }>}
     */
    async logout(studentId) {
        throw new Error(`[${this.providerName}] logout() not implemented`);
    }

    // ─── Academic Data ───────────────────────────────────────────────────────────

    /**
     * Retrieve attendance records for a student.
     *
     * @param {string} studentId
     * @param {{ cookies?: string }} [options]
     * @returns {Promise<import('../../models/normalized').AttendanceResult>}
     */
    async getAttendance(studentId, options = {}) {
        throw new Error(`[${this.providerName}] getAttendance() not implemented`);
    }

    /**
     * Retrieve marks/results for a student.
     *
     * @param {string} studentId
     * @param {{ cookies?: string }} [options]
     * @returns {Promise<import('../../models/normalized').MarksResult>}
     */
    async getMarks(studentId, options = {}) {
        throw new Error(`[${this.providerName}] getMarks() not implemented`);
    }

    /**
     * Retrieve enrolled subjects for a student.
     *
     * @param {string} studentId
     * @param {{ cookies?: string }} [options]
     * @returns {Promise<import('../../models/normalized').SubjectRecord[]>}
     */
    async getSubjects(studentId, options = {}) {
        throw new Error(`[${this.providerName}] getSubjects() not implemented`);
    }

    /**
     * Retrieve weekly timetable for a student.
     *
     * @param {string} studentId
     * @param {{ cookies?: string }} [options]
     * @returns {Promise<import('../../models/normalized').TimetableRecord[]>}
     */
    async getTimetable(studentId, options = {}) {
        throw new Error(`[${this.providerName}] getTimetable() not implemented`);
    }

    /**
     * Retrieve assignments list for a student.
     *
     * @param {string} studentId
     * @param {{ cookies?: string }} [options]
     * @returns {Promise<import('../../models/normalized').AssignmentResult>}
     */
    async getAssignments(studentId, options = {}) {
        throw new Error(`[${this.providerName}] getAssignments() not implemented`);
    }

    /**
     * Retrieve exam schedule for a student.
     *
     * @param {string} studentId
     * @param {{ cookies?: string }} [options]
     * @returns {Promise<import('../../models/normalized').ExamResult>}
     */
    async getExams(studentId, options = {}) {
        throw new Error(`[${this.providerName}] getExams() not implemented`);
    }

    // ─── Financial Data ──────────────────────────────────────────────────────────

    /**
     * Retrieve fee statement for a student.
     *
     * @param {string} studentId
     * @param {{ cookies?: string }} [options]
     * @returns {Promise<import('../../models/normalized').FeeResult>}
     */
    async getFees(studentId, options = {}) {
        throw new Error(`[${this.providerName}] getFees() not implemented`);
    }

    /**
     * Retrieve fee transaction history for a student.
     *
     * @param {string} studentId
     * @param {{ cookies?: string }} [options]
     * @returns {Promise<import('../../models/normalized').TransactionRecord[]>}
     */
    async getTransactions(studentId, options = {}) {
        throw new Error(`[${this.providerName}] getTransactions() not implemented`);
    }

    // ─── Communication Data ──────────────────────────────────────────────────────

    /**
     * Retrieve notifications for a student.
     *
     * @param {string} studentId
     * @param {{ cookies?: string }} [options]
     * @returns {Promise<import('../../models/normalized').NotificationRecord[]>}
     */
    async getNotifications(studentId, options = {}) {
        throw new Error(`[${this.providerName}] getNotifications() not implemented`);
    }

    /**
     * Retrieve college announcements.
     *
     * @param {string} studentId
     * @param {{ cookies?: string }} [options]
     * @returns {Promise<import('../../models/normalized').NotificationRecord[]>}
     */
    async getAnnouncements(studentId, options = {}) {
        throw new Error(`[${this.providerName}] getAnnouncements() not implemented`);
    }

    // ─── Sync Operations ─────────────────────────────────────────────────────────

    /**
     * Perform a complete ERP data synchronization for a student.
     * Implementations should login, fetch ALL data modules, and return
     * a structured sync result with normalized data objects.
     *
     * @param {string} userId
     * @param {string} password
     * @returns {Promise<import('../../models/normalized').SyncResult>}
     */
    async syncStudent(userId, password) {
        throw new Error(`[${this.providerName}] syncStudent() not implemented`);
    }

    /**
     * Perform an incremental sync using an existing valid session.
     * Should be faster than full sync — reuses cookies, skips re-login.
     * Falls back to full sync if session has expired.
     *
     * @param {string} userId
     * @param {string} password
     * @param {{ cookies: string }} session
     * @returns {Promise<import('../../models/normalized').SyncResult>}
     */
    async syncIncremental(userId, password, session) {
        throw new Error(`[${this.providerName}] syncIncremental() not implemented`);
    }

    // ─── Health & Diagnostics ────────────────────────────────────────────────────

    /**
     * Check if the ERP portal/API is currently reachable and healthy.
     *
     * @returns {Promise<{ healthy: boolean, responseTimeMs: number, provider: string, details?: object }>}
     */
    async checkERPHealth() {
        throw new Error(`[${this.providerName}] checkERPHealth() not implemented`);
    }

    /**
     * Validate that a student session is still active on the ERP.
     *
     * @param {string} studentId
     * @param {{ cookies: string }} session
     * @returns {Promise<{ valid: boolean, expiresAt?: Date }>}
     */
    async validateSession(studentId, session) {
        throw new Error(`[${this.providerName}] validateSession() not implemented`);
    }
}

module.exports = ERPProvider;
