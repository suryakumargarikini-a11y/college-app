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
    constructor() {
        super();
        const forecaster = require('./forecasting/ScraperReliabilityForecaster');
        forecaster.startPeriodicForecasting();
        const healthScorer = require('./health/ERPHealthScorer');
        healthScorer.startPeriodicScoring();
    }

    get providerName() {
        return 'sitam-scraper';
    }

    /**
     * Authenticate a student and return session data.
     * Wraps PuppeteerService.login() and translates outcomes to provider errors.
     */
    async login(credentials) {
        const { userId, password, recoveryPlan } = credentials;
        const startMs = Date.now();

        try {
            logger.info(`[SITAMScraper] Initiating login for ${userId}`);

            // Lazy-load to avoid circular dependencies at module load time
            const puppeteerService = require('../../services/puppeteerService');
            const { cookieString, scrapedData } = await puppeteerService.login(userId, password, 'unknown', recoveryPlan);

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
            const erpBaseUrl = (process.env.ERP_BASE_URL || 'https://sitamecap.co.in/SATYA').replace(/\/$/, '');
            const resp = await axios.get(`${erpBaseUrl}/Default.aspx`, {
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
        const recovery = require('./recovery/PartialSyncRecovery');
        const driftDetector = require('./drift/DOMDriftDetector');
        const forecaster = require('./forecasting/ScraperReliabilityForecaster');
        const healthScorer = require('./health/ERPHealthScorer');
        const qpm = require('./throttle/QueuePressureManager');
        const shedder = require('./throttle/AdaptiveLoadShedding');
        // Circuit breaker — lazy-loaded to avoid circular dependency at startup
        const circuitBreaker = require('../../services/circuitBreaker');

        // Record sync attempt in forecaster
        forecaster.recordSyncAttempt();

        return traceSpan('provider.scraper.sync_student', {
            'provider.name':   this.providerName,
            'sync.type':       'full',
            'user.id':         userId
        }, async (span) => {
            // ── Circuit breaker guard ──────────────────────────────────────────
            // If the ERP has failed 5 consecutive times (Chromium crash, network
            // timeout, etc.), the circuit opens for up to 5 minutes. During that
            // window, sync calls fail fast without launching Chromium. This prevents
            // the browser pool from being flooded with doomed requests during an
            // ERP outage.
            //
            // Auth errors (wrong password) are NOT counted as ERP failures \u2014 the
            // circuit breaker already handles this in its _onFailure logic.
            return circuitBreaker.execute(async () => {
            try {
                logger.info(`[SITAMScraper] Starting full sync for ${userId}`);

                // Load recovery plan
                const recoveryPlan = await recovery.getRecoveryPlan(userId);

                // 1. Login and get raw scraped data (passing the recovery plan to only scrape what is missing)
                const loginResult = await this.login({ userId, password, recoveryPlan });
                const { cookies, scrapedData } = loginResult;

                // Merge in cached HTML from previous runs for modules that were skipped in this run
                for (const moduleName of ['profile', 'marks', 'fees', 'assignments']) {
                    if (!recoveryPlan.includes(moduleName)) {
                        const cachedHtml = recovery.getCachedData(userId, moduleName);
                        if (cachedHtml) {
                            scrapedData[`${moduleName}Html`] = cachedHtml;
                        }
                    }
                }

                // Analyze DOM drift for successfully scraped modules in this run
                for (const moduleName of ['profile', 'marks', 'fees', 'assignments']) {
                    const htmlKey = `${moduleName}Html`;
                    if (scrapedData[htmlKey] && recoveryPlan.includes(moduleName)) {
                        const currentFp = driftDetector.fingerprint(scrapedData[htmlKey], moduleName);
                        const baselineFp = await driftDetector._loadBaseline(moduleName);
                        if (!baselineFp) {
                            await driftDetector._saveBaseline(moduleName, currentFp);
                            logger.info(`[SITAMScraper] Stored initial baseline for page "${moduleName}"`);
                        } else {
                            const { score, changes } = driftDetector.computeDriftScore(currentFp, baselineFp);
                            
                            // Upgrade 3: Protect Against False Positives (DOM drift thresholds)
                            if (score >= 80) {
                                // Critical: fail sync
                                providerMetrics.recordDOMDrift('sitam-scraper', moduleName, score);
                                throw new SelectorDriftError(
                                    `Critical DOM drift detected on page "${moduleName}" (score: ${score}/100). ERP may have redesigned.`,
                                    {
                                        providerName: 'sitam-scraper',
                                        operationName: `scrape:${moduleName}`,
                                        selectorAttempts: changes
                                    }
                                );
                            } else if (score >= 50) {
                                // Warning: emit telemetry/log only, do NOT fail sync
                                logger.warn(`[SITAMScraper] Warning DOM drift on "${moduleName}" (score: ${score}/100). Changes: ${changes.join('; ')}`);
                                providerMetrics.recordDOMDrift('sitam-scraper', moduleName, score);
                            } else {
                                // Healthy: continue normally
                                logger.info(`[SITAMScraper] DOM structure healthy for "${moduleName}" (score: ${score}/100)`);
                            }
                        }
                    }
                }

                // 2. Store session for potential incremental reuse
                await providerSession.store(userId, {
                    cookies,
                    provider:    this.providerName,
                    studentName: loginResult.studentName
                });

                // 3. Normalize all scraped data into model objects
                const syncResult = this._normalizeScrapedData(scrapedData, userId);

                // Save checkpoints for successfully completed modules
                let hasFailure = false;
                for (const moduleName of ['profile', 'marks', 'fees', 'assignments']) {
                    const html = scrapedData[`${moduleName}Html`];
                    if (html && html.trim().length > 0) {
                        await recovery.saveCheckpoint(userId, moduleName, 'done', html);
                    } else {
                        await recovery.saveCheckpoint(userId, moduleName, 'failed', null);
                        hasFailure = true;
                    }
                }

                if (!hasFailure) {
                    await recovery.clearCheckpoint(userId);
                }

                const durationMs = Date.now() - startMs;
                providerMetrics.recordOperation(this.providerName, 'syncStudent', 'success', durationMs);
                providerMetrics.recordSyncSuccess(this.providerName, 'full');
                
                // Record telemetry and update health score
                healthScorer.recordLoginAttempt(true);
                healthScorer.recordSyncCompletion(true, durationMs);
                
                const score = await healthScorer.getHealthScore();
                providerMetrics.setHealthScore(this.providerName, score);
                qpm.updateFromHealthScore(score);
                shedder.updateFromHealthScore(score);

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

                // Record failure details in forecaster and health scorer
                forecaster.recordSyncFailure();
                if (err.constructor.name === 'CaptchaDetectedError') {
                    forecaster.recordCaptchaHit();
                    healthScorer.recordCaptchaDetection();
                } else if (err.constructor.name === 'AuthenticationError') {
                    healthScorer.recordLoginAttempt(false);
                } else {
                    healthScorer.recordSyncCompletion(false, durationMs);
                }

                const score = await healthScorer.getHealthScore();
                providerMetrics.setHealthScore(this.providerName, score);
                qpm.updateFromHealthScore(score);
                shedder.updateFromHealthScore(score);

                if (span) {
                    span.setAttribute('sync.success', false);
                    span.setAttribute('error.type', err.constructor.name);
                }

                // Re-throw as classified provider error
                throw (err instanceof Error ? classifyError(err, { providerName: this.providerName, operationName: 'syncStudent' }) : err);
            }
            }, userId); // ← closes circuitBreaker.execute()
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
                    const result = await puppeteerService.loginWithCookies(userId, session.cookies);
                    scrapedData = result.scrapedData;
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

    /**
     * Open a headed browser that logs the student into the real ERP and redirects straight to payments page.
     */
    async openPaymentWindow(userId, password) {
        logger.info(`[SITAMScraperProvider] Initiating headed payment browser auto-login for user: ${userId}`);

        const puppeteer = require('puppeteer');
        const browserPool = require('../../services/browserPool');

        const isProduction = (process.env.RAILWAY_ENVIRONMENT || process.env.NODE_ENV === 'production') && process.platform !== 'win32';
        const executablePath = browserPool.findChromiumExecutable();

        let browser;
        if (isProduction) {
            browser = await puppeteer.launch({
                headless: 'new',
                executablePath,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-gpu'
                ]
            });
        } else {
            // Launch browser in HEADED mode (headless: false) for local dev
            browser = await puppeteer.launch({
                headless: false,
                defaultViewport: null,
                args: ['--no-sandbox', '--disable-setuid-sandbox']
            });
        }

        const page = await browser.newPage();
        
        const baseUrl = (process.env.ERP_BASE_URL || 'https://sitamecap.co.in/SATYA').replace(/\/$/, '');

        try {
            // 1. Go to ERP Login
            await page.goto(`${baseUrl}/Default.aspx`, { waitUntil: 'networkidle2', timeout: 35000 });

            // 2. Type credentials and authenticate
            await page.waitForSelector('#txtId2', { timeout: 10000 });
            await page.click('#txtId2');
            await page.type('#txtId2', userId, { delay: 30 });
            await page.click('#txtPwd2');
            await page.type('#txtPwd2', password, { delay: 30 });
            await page.evaluate(() => document.getElementById('txtPwd2').blur());
            await new Promise(resolve => setTimeout(resolve, 400));

            await Promise.all([
                page.click('#imgBtn2'),
                page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 25000 })
            ]);

            logger.info(`[SITAMScraperProvider] Authenticated successfully in headed browser for ${userId}. Navigating to online payment page...`);

            // 3. Direct redirect to online payment page
            await page.goto(`${baseUrl}/FeePayments/onlinepayment.aspx`, { waitUntil: 'networkidle2', timeout: 25000 });

            logger.info(`[SITAMScraperProvider] Redirected to payments successfully. Headed browser left active.`);
        } catch (err) {
            logger.error(`[SITAMScraperProvider] Error during headed payment window flow: ${err.message}`);
            try {
                await browser.close();
            } catch (_) {}
            throw err;
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
            const erpBaseUrl = (process.env.ERP_BASE_URL || 'https://sitamecap.co.in/SATYA').replace(/\/$/, '');
            const resp  = await axios.head(`${erpBaseUrl}/Default.aspx`, { timeout: 8000, maxRedirects: 3 });
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
