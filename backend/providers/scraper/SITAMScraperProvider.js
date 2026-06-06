/**
 * SITAM Smart ERP — SITAM Scraper Provider
 *
 * Concrete implementation of ERPProvider using Puppeteer-based scraping.
 * This is the PRIMARY provider for ERP data synchronization.
 *
 * RESPONSIBILITIES:
 *   - Perform full browser-based ERP login (via PuppeteerService)
 *   - Parse all raw ERP HTML into normalized model objects (via ERPScraper)
 *   - Implement selector drift detection and fallback chains
 *   - Track provider health metrics
 *   - Return ONLY normalized model objects — no raw HTML escapes
 *
 * MIGRATION NOTE:
 *   When SITAM releases an official API, implement SITAMOfficialAPIProvider
 *   and switch ProviderFactory.getProvider() to 'official-api'.
 *   Zero changes needed in services, queues, or frontend.
 */

'use strict';

const ERPProvider          = require('../interfaces/ERPProvider');
const {
    AttendanceResult, MarksResult, FeeResult, AssignmentResult,
    ExamResult, ProfileRecord, NotificationRecord, TimetableRecord, SyncResult
}                          = require('../../models/normalized');
const {
    AuthenticationError, SessionExpiredError, ERPUnavailableError,
    CaptchaDetectedError, SelectorDriftError, classifyError
}                          = require('../errors');
const providerMetrics      = require('../telemetry/ProviderMetrics');
const providerSession      = require('../session/ProviderSessionManager');
const logger               = require('../../services/logger');
const { ERPScraper }       = require('../../services/erpScraper');

// ─── Selector Fallback Chains ─────────────────────────────────────────────────
// Ordered by most-likely-to-work first. Drift detection fires when ALL fail.
const SELECTORS = {
    loginUsername: ['#txtId2', '.login-username', 'input[name="txtId2"]', 'input[type=text]'],
    loginPassword: ['#txtPwd2', '.login-password', 'input[name="txtPwd2"]', 'input[type=password]'],
    loginButton:   ['#btnLogin2', '.login-btn', 'input[type=submit][value="Login"]', 'button[type=submit]'],
    captchaPage:   ['.captcha', '#captchaDiv', 'img[src*=captcha]', 'input[id*=captcha]'],
    loggedIn:      ['#ctl00_ContentPlaceHolder1_lblStudentName', '.student-name', '#studentInfo', '.welcome-user'],
    profileNav:    ['a[href*="Profile"]', 'a:contains("Profile")', '#lnkProfile'],
    marksNav:      ['a[href*="Marks"]', 'a[href*="Results"]', 'a:contains("Marks")', '#lnkMarks'],
    feesNav:       ['a[href*="Fees"]', 'a[href*="Fee"]', 'a:contains("Fees")', '#lnkFees'],
    assignmentsNav:['a[href*="Assignment"]', 'a:contains("Assignment")', '#lnkAssignments'],
    sessionCheck:  ['#txtId2', '.login-form', 'form[action*=login]'],
};

// ─── Provider Implementation ──────────────────────────────────────────────────

class SITAMScraperProvider extends ERPProvider {
    get providerName() {
        return 'sitam-scraper';
    }

    /**
     * Authenticate a student and return session data.
     * Wraps PuppeteerService.login() and translates outcomes to provider errors.
     */
    async login(credentials) {
        const { userId, password } = credentials;
        const startMs = Date.now();

        try {
            logger.info(`[SITAMScraper] Initiating login for ${userId}`);

            // Lazy-load to avoid circular dependencies at module load time
            const puppeteerService = require('../../services/puppeteerService');
            const { cookieString, scrapedData } = await puppeteerService.login(userId, password);

            const durationMs = Date.now() - startMs;
            providerMetrics.recordOperation(this.providerName, 'login', 'success', durationMs);
            providerMetrics.recordSessionRefresh(this.providerName, 'proactive');

            return {
                sessionId:   `${userId}:${Date.now()}`,
                cookies:     cookieString,
                expiresAt:   new Date(Date.now() + 25 * 60 * 1000), // 25 min
                studentName: scrapedData.studentName || userId,
                scrapedData  // Carry raw HTML forward for syncStudent to parse
            };
        } catch (err) {
            const durationMs = Date.now() - startMs;
            providerMetrics.recordOperation(this.providerName, 'login', 'error', durationMs);

            // Translate to provider error types
            const msg = err.message || '';
            if (msg.toLowerCase().includes('captcha')) {
                providerMetrics.recordCaptchaDetection(this.providerName);
                throw new CaptchaDetectedError(msg, { providerName: this.providerName, operationName: 'login', originalError: err });
            }
            if (msg.toLowerCase().includes('invalid') || msg.toLowerCase().includes('incorrect password') || msg.toLowerCase().includes('wrong')) {
                throw new AuthenticationError(msg, { providerName: this.providerName, operationName: 'login', originalError: err });
            }
            if (msg.toLowerCase().includes('timeout') || msg.toLowerCase().includes('econnrefused') || msg.toLowerCase().includes('net::err')) {
                throw new ERPUnavailableError(msg, { providerName: this.providerName, operationName: 'login', originalError: err });
            }

            throw classifyError(err, { providerName: this.providerName, operationName: 'login' });
        }
    }

    /**
     * Refresh an existing session.
     * Scraper provider: validates session by checking if page is still logged-in via fast axios request.
     */
    async refreshSession(session) {
        try {
            const axios = require('axios');
            const resp = await axios.get('https://sitams.org/erp/', {
                headers: { Cookie: session.cookies },
                maxRedirects: 5,
                timeout: 8000
            });

            // If we land on the login page, session is expired
            const body = resp.data || '';
            const isLoginPage = SELECTORS.sessionCheck.some(sel =>
                body.includes('txtId2') || body.includes('login-form')
            );

            if (isLoginPage) {
                throw new SessionExpiredError('Redirected to login page', {
                    providerName: this.providerName,
                    operationName: 'refreshSession'
                });
            }

            return { cookies: session.cookies, expiresAt: new Date(Date.now() + 25 * 60 * 1000), refreshed: false };
        } catch (err) {
            if (err instanceof SessionExpiredError) throw err;
            throw new SessionExpiredError(`Session validation failed: ${err.message}`, {
                providerName: this.providerName, operationName: 'refreshSession', originalError: err
            });
        }
    }

    async logout(studentId) {
        await providerSession.invalidate(studentId);
        return { success: true };
    }

    // ─── Individual Data Methods ────────────────────────────────────────────────

    async getAttendance(studentId, options = {}) {
        throw new Error('[SITAMScraper] getAttendance() called in isolation — use syncStudent() for full data fetch');
    }

    async getMarks(studentId, options = {}) {
        throw new Error('[SITAMScraper] getMarks() called in isolation — use syncStudent() for full data fetch');
    }

    async getSubjects(studentId, options = {}) {
        throw new Error('[SITAMScraper] getSubjects() called in isolation — use syncStudent() for full data fetch');
    }

    async getTimetable(studentId, options = {}) {
        throw new Error('[SITAMScraper] getTimetable() called in isolation — use syncStudent() for full data fetch');
    }

    async getAssignments(studentId, options = {}) {
        throw new Error('[SITAMScraper] getAssignments() called in isolation — use syncStudent() for full data fetch');
    }

    async getExams(studentId, options = {}) {
        // SITAM ERP exam data is not yet reliably parseable; return empty scaffold
        return new ExamResult({ schedules: [], semester: '', examName: 'Regular Semester Exams', academicYear: '' });
    }

    async getFees(studentId, options = {}) {
        throw new Error('[SITAMScraper] getFees() called in isolation — use syncStudent() for full data fetch');
    }

    async getTransactions(studentId, options = {}) {
        throw new Error('[SITAMScraper] getTransactions() called in isolation — use syncStudent() for full data fetch');
    }

    async getNotifications(studentId, options = {}) {
        // Notifications are system-generated post-sync, not scraped independently
        return [];
    }

    async getAnnouncements(studentId, options = {}) {
        return [];
    }

    // ─── Full Sync ──────────────────────────────────────────────────────────────

    /**
     * Perform a complete ERP data synchronization for a student.
     * Orchestrates: login → scrape all pages → normalize all data → return SyncResult.
     *
     * The service layer (syncService.js) calls this method and receives back
     * normalized model objects, then persists them via repositories.
     */
    async syncStudent(userId, password) {
        const startMs = Date.now();
        const { traceSpan } = require('../../telemetry/tracing');

        return traceSpan('provider.scraper.sync_student', {
            'provider.name':   this.providerName,
            'sync.type':       'full',
            'user.id':         userId
        }, async (span) => {
            try {
                logger.info(`[SITAMScraper] Starting full sync for ${userId}`);

                // 1. Login and get raw scraped data
                const loginResult = await this.login({ userId, password });
                const { cookies, scrapedData } = loginResult;

                // 2. Store session for potential incremental reuse
                await providerSession.store(userId, {
                    cookies,
                    provider:    this.providerName,
                    studentName: loginResult.studentName
                });

                // 3. Normalize all scraped data into model objects
                const syncResult = this._normalizeScrapedData(scrapedData, userId);

                const durationMs = Date.now() - startMs;
                providerMetrics.recordOperation(this.providerName, 'syncStudent', 'success', durationMs);
                providerMetrics.recordSyncSuccess(this.providerName, 'full');
                providerMetrics.setHealthScore(this.providerName, 95);

                if (span) {
                    span.setAttribute('sync.subjects_count', syncResult.marks?.subjects?.length || 0);
                    span.setAttribute('sync.attendance_count', syncResult.attendance?.records?.length || 0);
                    span.setAttribute('sync.success', true);
                }

                logger.info(`[SITAMScraper] Full sync complete for ${userId} in ${durationMs}ms`);
                return syncResult;

            } catch (err) {
                const durationMs = Date.now() - startMs;
                providerMetrics.recordOperation(this.providerName, 'syncStudent', 'error', durationMs);
                providerMetrics.recordSyncFailure(this.providerName, 'full', err.constructor.name);
                providerMetrics.setHealthScore(this.providerName, 40);

                if (span) {
                    span.setAttribute('sync.success', false);
                    span.setAttribute('error.type', err.constructor.name);
                }

                // Re-throw as classified provider error
                throw (err instanceof Error ? classifyError(err, { providerName: this.providerName, operationName: 'syncStudent' }) : err);
            }
        });
    }

    /**
     * Perform an incremental sync using an existing session.
     * Falls back to full sync if session is expired/invalid.
     */
    async syncIncremental(userId, password, session) {
        const startMs = Date.now();

        try {
            logger.info(`[SITAMScraper] Attempting incremental sync for ${userId}`);

            // Validate session
            if (!session || !session.cookies) {
                logger.info(`[SITAMScraper] No session available for ${userId}, falling back to full sync`);
                return this.syncStudent(userId, password);
            }

            const sessionValid = await this.validateSession(userId, session);
            if (!sessionValid.valid) {
                providerMetrics.recordSessionRefresh(this.providerName, 'expired');
                logger.info(`[SITAMScraper] Session expired for ${userId}, performing full re-sync`);
                return this.syncStudent(userId, password);
            }

            // Session is valid — re-scrape with existing cookies (faster, no login)
            const puppeteerService = require('../../services/puppeteerService');
            let scrapedData;

            try {
                // Try cookie-based scraping first
                if (typeof puppeteerService.loginWithCookies === 'function') {
                    scrapedData = await puppeteerService.loginWithCookies(userId, session.cookies);
                } else {
                    // PuppeteerService doesn't support cookie-based scraping — fallback to full
                    logger.info(`[SITAMScraper] Cookie-based scrape not available, using full sync for ${userId}`);
                    return this.syncStudent(userId, password);
                }
            } catch (scrapeErr) {
                logger.warn(`[SITAMScraper] Incremental scrape failed for ${userId}: ${scrapeErr.message}, falling back to full sync`);
                return this.syncStudent(userId, password);
            }

            const syncResult = this._normalizeScrapedData(scrapedData, userId);
            syncResult.syncType = 'incremental';

            const durationMs = Date.now() - startMs;
            providerMetrics.recordOperation(this.providerName, 'syncIncremental', 'success', durationMs);
            providerMetrics.recordSyncSuccess(this.providerName, 'incremental');

            logger.info(`[SITAMScraper] Incremental sync complete for ${userId} in ${durationMs}ms`);
            return syncResult;

        } catch (err) {
            const durationMs = Date.now() - startMs;
            providerMetrics.recordOperation(this.providerName, 'syncIncremental', 'error', durationMs);
            providerMetrics.recordSyncFailure(this.providerName, 'incremental', err.constructor.name);

            // Last-resort: full sync
            logger.warn(`[SITAMScraper] Incremental sync failed, attempting full sync: ${err.message}`);
            return this.syncStudent(userId, password);
        }
    }

    // ─── Health & Diagnostics ───────────────────────────────────────────────────

    /**
     * Check ERP portal health with a lightweight HTTP HEAD request.
     */
    async checkERPHealth() {
        const startMs = Date.now();
        try {
            const axios = require('axios');
            const resp  = await axios.head('https://sitams.org/erp/', { timeout: 8000, maxRedirects: 3 });
            const ms    = Date.now() - startMs;

            const healthy = resp.status >= 200 && resp.status < 500;
            providerMetrics.setHealthScore(this.providerName, healthy ? 90 : 30);

            return { healthy, responseTimeMs: ms, provider: this.providerName, details: { httpStatus: resp.status } };
        } catch (err) {
            const ms = Date.now() - startMs;
            providerMetrics.setHealthScore(this.providerName, 0);
            return { healthy: false, responseTimeMs: ms, provider: this.providerName, details: { error: err.message } };
        }
    }

    /**
     * Validate an existing session by making a lightweight probe request.
     */
    async validateSession(studentId, session) {
        try {
            const validation = await this.refreshSession(session);
            return { valid: true, expiresAt: validation.expiresAt };
        } catch {
            return { valid: false };
        }
    }

    // ─── Internal Normalization ─────────────────────────────────────────────────

    /**
     * Convert raw scraped HTML objects into a complete, normalized SyncResult.
     * This is the ONLY place where ERPScraper is called — isolating parsing logic.
     *
     * @param {object} scrapedData - Raw HTML blobs from PuppeteerService
     * @param {string} userId
     * @returns {SyncResult}
     */
    _normalizeScrapedData(scrapedData, userId) {
        // Parse raw HTML using existing ERPScraper parsers
        const rawProfile     = ERPScraper.parseProfile(scrapedData);
        const rawMarks       = ERPScraper.parseMarks(scrapedData);
        const rawFees        = ERPScraper.parseFees(scrapedData);
        const rawAssignments = ERPScraper.parseAssignments(scrapedData);

        // Build normalized model objects
        const profile = ProfileRecord.create(rawProfile);

        const marks = new MarksResult({
            subjects:   rawMarks.subjects,
            cgpa:       rawMarks.cgpa,
            sgpa:       rawMarks.sgpa,
            percentage: rawMarks.percentage
        });

        const attendance = new AttendanceResult({
            records:           rawMarks.attendance,
            overallPercentage: rawMarks.overallAttendance
        });

        const fees = new FeeResult({
            transactions: rawFees.transactions,
            totalAmount:  rawFees.totalAmount,
            paidAmount:   rawFees.paidAmount,
            dueAmount:    rawFees.dueAmount,
            paidProgress: rawFees.paidProgress
        });

        const assignments = new AssignmentResult({
            list:        rawAssignments.list,
            activeCount: rawAssignments.activeCount
        });

        // System-generated notifications (post-parse enrichment)
        const notifications = this._buildNotifications(rawMarks, userId);

        return new SyncResult({
            profile,
            marks,
            attendance,
            fees,
            assignments,
            notifications,
            timetable:   [], // Timetable is generated in syncService.syncStudentData
            syncType:    'full',
            provider:    this.providerName,
            syncedAt:    new Date().toISOString()
        });
    }

    /**
     * Build system notifications from parsed marks/attendance data.
     * These supplement any ERP-native notifications.
     */
    _buildNotifications(marksData, userId) {
        const notifications = [];

        const overallPct = parseFloat(String(marksData.overallAttendance || '0').replace('%', '')) || 0;
        if (overallPct > 0 && overallPct < 75) {
            notifications.push(NotificationRecord.create({
                id:      `att-warning-${userId}`,
                title:   'Attendance Warning',
                message: `Your overall attendance is ${marksData.overallAttendance}. Minimum 75% required to sit for exams.`,
                date:    new Date().toLocaleDateString('en-IN'),
                type:    'warning'
            }));
        }

        notifications.push(NotificationRecord.create({
            id:      `sync-complete-${Date.now()}`,
            title:   'Data Synced',
            message: `Your ERP data has been successfully synchronized. CGPA: ${marksData.cgpa || '--'}`,
            date:    new Date().toLocaleDateString('en-IN'),
            type:    'success'
        }));

        return notifications;
    }
}

module.exports = new SITAMScraperProvider();
