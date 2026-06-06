const axios = require('axios');
const logger = require('./logger');
const sessionManager = require('./sessionManager');
const syncService = require('./syncService');
const socketService = require('./socketService');
const cacheService = require('./cacheService');
const prisma = require('./dbService');
const firebaseService = require('./firebaseService');
const workerService = require('./workerService');

class SyncQueue {
    constructor() {
        this.workers = new Map(); // Maps userId -> boolean indicating active worker
        this.queueTimer = null;
    }

    /**
     * Start background sync workers for all active sessions in the session manager.
     */
    start() {
        logger.info('[SyncQueue] Initializing scheduled background sync workers.');
        
        // Main queue tick: runs every 60 seconds to scan active sessions and schedule individual syncs
        this.queueTimer = setInterval(() => this.tick(), 60000);
        
        // Run first tick immediately in background
        this.tick();
    }

    /**
     * Scan active sessions and trigger background synchronization if needed.
     */
    async tick() {
        const now = Date.now();
        const activeSessions = Array.from(sessionManager.sessions.values());
        
        for (const session of activeSessions) {
            const { userId, password, cookies, lastUsed } = session;
            
            // Only sync active users (logged in within the last 30 minutes)
            if (now - lastUsed > 30 * 60 * 1000) {
                continue;
            }

            // If a worker is already running or scheduled for this user, skip
            if (this.workers.has(userId)) {
                continue;
            }

            // Schedule and enqueue sync through decoupled worker manager
            workerService.enqueueSync(userId, password, false)
                .catch(err => logger.error(`[SyncQueue] Failed to enqueue background sync for ${userId}: ${err.message}`));
        }
    }

    /**
     * Synchronize a specific student's data using lightweight cookie-reusing Axios requests.
     * Fallback to full Puppeteer sync if session cookie has expired.
     */
    async syncStudentIncrementally(userId, password, cookies) {
        const { traceSpan } = require('../telemetry/tracing');
        return traceSpan('sync.incremental', {
            'user.id': userId,
            'sync.type': 'incremental'
        }, async (span) => {
            logger.info(`[SyncQueue] Starting background incremental sync for: ${userId}`);
            const siteBase = process.env.ERP_BASE_URL ? process.env.ERP_BASE_URL.split('/SATYA')[0] : 'https://sitamecap.co.in';

            try {
            // 1. Perform a test fast request using current session cookies to see if they are still active
            const testUrl = `${siteBase}/SATYA/Academics/StudentProfile.aspx`;
            const testResponse = await axios.get(testUrl, {
                headers: {
                    'Cookie': cookies,
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                },
                maxRedirects: 5,
                validateStatus: (status) => status === 200
            });

            // If we got redirected back to default login page, the cookie has expired
            if (testResponse.data.includes('Default.aspx') || testResponse.data.includes('txtId2')) {
                logger.warn(`[SyncQueue] Session cookies expired for student: ${userId}. Triggering Puppeteer re-login session refresh.`);
                // Trigger full sync using Puppeteer to re-login and save new cookies
                await syncService.triggerBackgroundSync(userId, password);
                
                // Notify WebSocket client
                socketService.sendToUser(userId, 'sync_complete', {
                    status: 'success',
                    source: 'relogin',
                    timestamp: new Date().toISOString()
                });
                return;
            }

            // 2. Session is alive! Reuse cookies to execute fast Cheerio crawls for critical dynamic panels
            logger.info(`[SyncQueue] Session cookies verified alive. Executing fast API-based crawls for: ${userId}`);
            
            // Crawl Marks & Attendance
            const marksUrl = `${siteBase}/SATYA/Academics/StudentMarksReport.aspx`;
            const marksHtml = await axios.get(marksUrl, {
                headers: { 'Cookie': cookies, 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
            }).then(res => res.data);

            // Crawl Fees
            const feesUrl = `${siteBase}/SATYA/FeePayments/studentpayments.aspx`;
            const feesHtml = await axios.get(feesUrl, {
                headers: { 'Cookie': cookies, 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
            }).then(res => res.data);

            // Crawl Assignments
            const assignmentsUrl = `${siteBase}/SATYA/Academics/StudentAssignmentsReport.aspx`;
            const assignmentsHtml = await axios.get(assignmentsUrl, {
                headers: { 'Cookie': cookies, 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
            }).then(res => res.data);

            // 3. Capture baseline database values before trigger sync
            const studentBefore = await prisma.student.findUnique({
                where: { userId },
                include: { marks: true, attendance: true, fees: true }
            });

            // 4. Trigger database persistency transaction
            const scrapedData = {
                studentName: userId,
                profileHtml: testResponse.data,
                marksHtml,
                feesHtml,
                assignmentsHtml
            };
            
            const studentId = studentBefore ? studentBefore.id : null;
            await syncService.syncStudentData(studentId, userId, password, scrapedData);

            // 5. Invalidate API caches
            cacheService.invalidate('attendance', userId);
            cacheService.invalidate('marks', userId);
            cacheService.invalidate('fees', userId);

            // 6. Fetch post-sync database values to identify changes
            const studentAfter = await prisma.student.findUnique({
                where: { userId },
                include: { marks: true, attendance: true, fees: true }
            });

            if (studentBefore && studentAfter) {
                // Check overall attendance changes
                const beforeOverall = studentBefore.percentage;
                const afterOverall = studentAfter.percentage;
                if (beforeOverall !== afterOverall) {
                    const { ERPScraper } = require('./erpScraper');
                    const parsedMarks = ERPScraper.parseMarks({ marksHtml });
                    socketService.sendToUser(userId, 'attendance_update', {
                        overall: parsedMarks.overallAttendance || '0%',
                        subjects: parsedMarks.attendance
                    });
                    logger.info(`[SyncQueue] Live Attendance changes detected! Sent WebSocket update for ${userId}`);
                    firebaseService.sendPushNotification(
                        userId,
                        'SITAM Attendance Alert',
                        `Your overall attendance has updated to ${parsedMarks.overallAttendance || '0%'}.`,
                        { route: '/attendance' }
                    );
                }

                // Check marks changes
                const beforeCGPA = studentBefore.cgpa;
                const afterCGPA = studentAfter.cgpa;
                if (beforeCGPA !== afterCGPA) {
                    const { ERPScraper } = require('./erpScraper');
                    const parsedMarks = ERPScraper.parseMarks({ marksHtml });
                    socketService.sendToUser(userId, 'marks_update', {
                        cgpa: parsedMarks.cgpa,
                        sgpa: parsedMarks.sgpa,
                        subjects: parsedMarks.subjects
                    });
                    logger.info(`[SyncQueue] Live Marks changes detected! Sent WebSocket update for ${userId}`);
                    firebaseService.sendPushNotification(
                        userId,
                        'SITAM Academic Results Update',
                        `New academic semester results have been published. Current CGPA: ${parsedMarks.cgpa || '--'}`,
                        { route: '/marks' }
                    );
                }

                // Check fees changes
                const beforeDue = studentBefore.fees.reduce((acc, f) => acc + f.dueAmount, 0);
                const afterDue = studentAfter.fees.reduce((acc, f) => acc + f.dueAmount, 0);
                if (beforeDue !== afterDue) {
                    const { ERPScraper } = require('./erpScraper');
                    const parsedFees = ERPScraper.parseFees({ feesHtml });
                    socketService.sendToUser(userId, 'fees_update', parsedFees);
                    logger.info(`[SyncQueue] Live Fees changes detected! Sent WebSocket update for ${userId}`);
                    firebaseService.sendPushNotification(
                        userId,
                        'SITAM Fee Statement Update',
                        `Your student balance ledger has been modified. Outstanding due: ${parsedFees.dueAmount || '₹0'}`,
                        { route: '/fees' }
                    );
                }
            }

            logger.info(`[SyncQueue] Background incremental sync completed for student: ${userId}`);
        } catch (err) {
            logger.error(`[SyncQueue] Background incremental sync aborted for ${userId}: ${err.message}`);
        }
        });
    }

    /**
     * Clean shutdown of scheduled queues.
     */
    shutdown() {
        if (this.queueTimer) {
            clearInterval(this.queueTimer);
        }
    }
}

module.exports = new SyncQueue();
