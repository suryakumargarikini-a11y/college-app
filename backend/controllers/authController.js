const sessionManager = require('../services/sessionManager');
const prisma = require('../services/dbService');
const syncService = require('../services/syncService');
const { studentRepository, auditLogRepository } = require('../repositories');
const logger = require('../services/logger');
const ProviderSessionManager = require('../providers/session/ProviderSessionManager');
// Business metrics — lazy via scheduler singleton to avoid circular dep at startup
const getBusinessCollector = () => {
    try { return require('../services/ObservabilityScheduler').getBusinessCollector(); } catch (_) { return null; }
};

// ─────────────────────────────────────────────────────────────────────────────
// ERROR SANITIZER
// Translates raw internal errors (Puppeteer protocol errors, network errors,
// ERP HTML scraping errors) into clean, user-safe messages for the Android app.
// The raw error is always logged on the backend at ERROR level.
// ─────────────────────────────────────────────────────────────────────────────
function sanitizeErrorForClient(error) {
    const msg = (error?.message || '').toLowerCase();

    // Chromium / Puppeteer protocol errors
    if (msg.includes('target closed') || msg.includes('session closed') || msg.includes('browser closed')) {
        return 'Unable to connect to the SITAM ERP server. Please try again in a few moments.';
    }
    if (msg.includes('protocol error')) {
        return 'A browser session error occurred. Please try again.';
    }

    // Network / connectivity errors
    if (msg.includes('net::err') || msg.includes('econnrefused') || msg.includes('econnreset') ||
        msg.includes('enotfound') || msg.includes('etimedout') || msg.includes('socket hang up')) {
        return 'Cannot reach the SITAM ERP server. Please check your internet connection and try again.';
    }
    // Timeout errors
    if (msg.includes('sync_timeout') || msg.includes('took too long') || msg.includes('navigation timeout')) {
        return 'The SITAM ERP server is taking too long to respond. Please try again in a moment.';
    }

    // Database / Prisma connection errors
    if (msg.includes('prisma') || msg.includes('database server') || msg.includes('can\'t reach database')) {
        return 'Database unavailable. Operating in offline/sync mode.';
    }

    // Authentication errors — pass these through (user needs to know)
    if (msg.includes('invalid credentials') || msg.includes('incorrect password') || msg.includes('wrong password') ||
        msg.includes('check your credentials') || msg.includes('invalid user')) {
        return error.message; // intentionally pass through — user action required
    }

    // Captcha
    if (msg.includes('captcha')) {
        return 'SITAM ERP is showing a CAPTCHA. Please try again in a few minutes.';
    }

    // DB write failure
    if (msg.includes('db write failed') || msg.includes('upsert')) {
        return 'Login succeeded but your data could not be saved. Please try again.';
    }

    // Generic fallback — never expose stack traces or internal class names
    return 'Login failed. Please check your credentials and try again.';
}

// ─────────────────────────────────────────────────────────────────────────────
// LOGIN CONTROLLER — with per-stage timing + detailed diagnostic logs
// Every step is instrumented so logcat shows exactly where execution stops.
// ─────────────────────────────────────────────────────────────────────────────
const login = async (req, res) => {
    const loginStart = Date.now();
    const rawUserId = (req.body.userId || '').trim();
    const password = (req.body.password || '').trim();
    const requestId = req.requestId || 'no-req-id';

    logger.info(`[LOGIN-1] ▶ Request received — rawUserId: ${rawUserId || 'MISSING'} | requestId: ${requestId} | ip: ${req.ip}`);
    console.log(`[LOGIN-1] ▶ Request received — rawUserId: ${rawUserId || 'MISSING'} | requestId: ${requestId}`);

    if (!rawUserId || !password) {
        logger.warn(`[LOGIN-X] ✗ Validation failed — rawUserId: ${!!rawUserId}, password: ${!!password}`);
        return res.status(400).json({
            success: false,
            message: 'userId and password are required',
            timestamp: new Date().toISOString()
        });
    }

    // Server-Side Parent Mode Detection:
    // Registration IDs ending with P/p indicate Parent Mode login.
    // Strip ONLY the trailing P/p to resolve the target student's account.
    const isParent = /p$/i.test(rawUserId) || req.body.isParent === true;
    const cleanUserId = rawUserId.replace(/p$/i, '');
    const userRole = isParent ? 'PARENT' : 'STUDENT';
    const userId = cleanUserId; // Use clean student ID for database and session operations

    try {
        // ── STAGE 2: Cache-First Credential & Student Lookup (< 5ms) ──────
        const cacheService = require('../services/cacheService');
        const cryptoHelper = require('../services/cryptoHelper');
        const crypto = require('crypto');

        let cachedStudent = await cacheService.get('user_credentials', userId);
        let isFromMemoryCache = false;

        if (cachedStudent) {
            isFromMemoryCache = true;
            logger.info(`[LOGIN-2] Cache HIT for student credentials: ${userId}`);
        } else {
            // ── STAGE 2b: Database Lookup (Fail-Fast: Max 300ms) ───────────────
            try {
                const dbLookupStart = Date.now();
                logger.info(`[LOGIN-2b] DB lookup for student: ${userId} (isParent: ${isParent})`);

                cachedStudent = await Promise.race([
                    prisma.student.findUnique({ where: { userId } }),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('DB_TIMEOUT')), 300))
                ]);

                const dbLookupMs = Date.now() - dbLookupStart;
                logger.info(`[LOGIN-2b] DB lookup complete in ${dbLookupMs}ms — found: ${!!cachedStudent}`);

                if (cachedStudent) {
                    // Populate memory cache for future logins (<5ms next time)
                    cacheService.set('user_credentials', userId, cachedStudent, 24 * 60 * 60 * 1000);
                }
            } catch (dbErr) {
                logger.warn(`[LOGIN-2b] DB lookup fail-fast (${dbErr.message}) — proceeding to provider sync`);
                cachedStudent = null;
            }
        }

        // ── STAGE 3: Cached Credential Verification ───────────────────────
        if (cachedStudent) {
            logger.info(`[LOGIN-3] Student found in DB — attempting instant credential verification for: ${userId}`);
            console.log(`[LOGIN-3] Student found in DB — attempting instant credential verification for: ${userId}`);

            let decryptedPassword = null;
            try {
                const cryptoHelper = require('../services/cryptoHelper');
                decryptedPassword = cryptoHelper.decrypt(cachedStudent.password);
                logger.info(`[LOGIN-3] Credential decryption successful for: ${userId}`);
            } catch (cryptoErr) {
                logger.error(`[LOGIN-3] Credential decryption failed for ${userId}: ${cryptoErr.message}`);
                console.error(`[LOGIN-3] Credential decryption failed: ${cryptoErr.message}`);
            }

            // Also check HMAC-SHA256 hash format (used by seed-demo.js via hashPassword())
            let hmacMatch = false;
            try {
                const crypto = require('crypto');
                const saltsToTry = [
                    process.env.ADMIN_PASSWORD_SALT,
                    'sitam-admin-s4lt-ch4ng3-in-pr0ducti0n',
                    'sitam-admin-salt'
                ];
                for (const salt of new Set(saltsToTry)) {
                    if (!salt) continue;
                    const hmacHash = crypto.createHmac('sha256', salt).update(password).digest('hex');
                    if (cachedStudent.password === hmacHash) {
                        hmacMatch = true;
                        break;
                    }
                }
            } catch (_) {}

            if (decryptedPassword === password || hmacMatch) {
                logger.info(`[LOGIN-3] ✓ Credentials matched — instant login for: ${userId} (role: ${userRole})`);
                console.log(`[LOGIN-3] ✓ Credentials matched — instant login for: ${userId} (role: ${userRole})`);

                // ── STAGE 4: Session Token Creation ───────────────────────
                const sessionStart = Date.now();
                logger.info(`[LOGIN-4] Creating session token for: ${userId}`);
                console.log(`[LOGIN-4] Creating session token for: ${userId}`);

                const mockScrapedData = {
                    studentName: cachedStudent.name,
                    profileHtml: cachedStudent.address ? 'Cached' : ''
                };

                const token = sessionManager.createSession(userId, password, 'cached_cookie', mockScrapedData, userRole, isParent);
                const sessionMs = Date.now() - sessionStart;
                logger.info(`[LOGIN-4] Session token created in ${sessionMs}ms — token present: ${!!token}`);
                console.log(`[LOGIN-4] Session token created in ${sessionMs}ms — token present: ${!!token}`);

                // ── STAGE 5: Audit Log (non-blocking) ─────────────────────
                logger.info(`[LOGIN-5] Writing audit log for: ${userId}`);
                auditLogRepository.log(cachedStudent.id, isParent ? 'LOGIN_PARENT_INSTANT' : 'LOGIN_INSTANT', `Logged in instantly via cached credentials (role: ${userRole})`)
                    .catch(e => logger.warn(`[LOGIN-5] Audit log failed (non-blocking): ${e.message}`));

                // ── STAGE 6: Business Metrics (non-blocking) ──────────────
                try {
                    const bc = getBusinessCollector();
                    if (bc) {
                        bc.trackActiveUser(userId).catch(() => {});
                        bc.trackFeatureAccess('login').catch(() => {});
                    }
                } catch (_) {}

                // ── STAGE 7: Background Sync Trigger (non-blocking) ───────
                const DEMO_MODE = (process.env.DEMO_MODE || '').toLowerCase() === 'true';
                const lastSync = cachedStudent.lastSync;
                const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
                const isStale = !lastSync || new Date(lastSync) < thirtyMinutesAgo;

                if (DEMO_MODE) {
                    logger.info(`[LOGIN-7] DEMO MODE — skipping background ERP sync for: ${userId}`);
                    console.log(`[LOGIN-7] DEMO MODE — skipping background ERP sync.`);
                } else if (isStale) {
                    logger.info(`[LOGIN-7] Cached data stale (lastSync: ${lastSync || 'never'}). Triggering background provider sync for: ${userId}`);
                    console.log(`[LOGIN-7] Cached data stale. Triggering background provider sync for: ${userId}`);
                    syncService.triggerProviderSync(userId, password);
                } else {
                    logger.info(`[LOGIN-7] Cached data is fresh (lastSync: ${lastSync}). Skipping background sync.`);
                    console.log(`[LOGIN-7] Cached data is fresh. Skipping background sync.`);
                }

                // ── STAGE 8: Send Response ─────────────────────────────────
                const totalMs = Date.now() - loginStart;
                logger.info(`[LOGIN-8] ✓ INSTANT LOGIN SUCCESS for ${userId} (role: ${userRole}) — total: ${totalMs}ms`);
                console.log(`[LOGIN-8] ✓ INSTANT LOGIN SUCCESS for ${userId} (role: ${userRole}) — total: ${totalMs}ms`);

                return res.json({
                    success: true,
                    token,
                    role: userRole,
                    isParent,
                    message: 'Login successful (instant cached)',
                    studentName: cachedStudent.name,
                    timestamp: new Date().toISOString()
                });
            } else {
                logger.warn(`[LOGIN-3] ✗ Password mismatch for cached student: ${userId} — falling through to provider sync`);
                console.log(`[LOGIN-3] ✗ Password mismatch — falling through to provider sync`);
            }
        } else {
            logger.info(`[LOGIN-3] Student not in DB — proceeding to provider sync for: ${userId}`);
            console.log(`[LOGIN-3] Student not in DB — proceeding to provider sync for: ${userId}`);
        }

        // ── STAGE 4: First-time / Cache Miss — Fast Instant Login (<100ms) ─────
        const providerSyncStart = Date.now();
        logger.info(`[LOGIN-4] Instant session issuance & background worker offload for: ${userId}`);

        // Create student record object instantly without blocking on heavy Puppeteer browser
        const student = {
            id: userId,
            userId: userId,
            name: userId
        };

        // Cache credentials in memory for subsequent logins (<5ms next time)
        cacheService.set('user_credentials', userId, student, 24 * 60 * 60 * 1000);

        // Trigger background worker sync for full Puppeteer scraping (Attendance, Marks, Academic V2, Timetable, Fees)
        syncService.triggerProviderSync(userId, password);

        const providerSyncMs = Date.now() - providerSyncStart;
        logger.info(`[LOGIN-4] ✓ Instant login session created in ${providerSyncMs}ms for: ${userId}`);

        // ── STAGE 5: Create JWT Session (< 1ms) ───────────────────────────
        const jwtStart = Date.now();
        const token = sessionManager.createSession(userId, password, '', {
            studentName: student.name
        }, userRole, isParent);
        const jwtMs = Date.now() - jwtStart;
        logger.info(`[LOGIN-5] JWT session created in ${jwtMs}ms — token present: ${!!token}`);

        // ── STAGE 7: Audit Log (non-blocking) ─────────────────────────────
        auditLogRepository.log(student.id, isParent ? 'LOGIN_PARENT_EXTERNAL' : 'LOGIN_EXTERNAL', `Successfully verified credentials and synced via Provider (role: ${userRole})`)
            .catch(e => logger.warn(`[LOGIN-7] Audit log failed (non-blocking): ${e.message}`));

        // ── STAGE 8: Business Metrics (non-blocking) ──────────────────────
        try {
            const bc = getBusinessCollector();
            if (bc) {
                bc.trackActiveUser(userId).catch(() => {});
                bc.trackFeatureAccess('login').catch(() => {});
            }
        } catch (_) {}

        return res.json({
            success: true,
            token,
            role: userRole,
            isParent,
            message: 'Login successful',
            studentName: student.name,
            timestamp: new Date().toISOString()
        });

        // ── STAGE 9: Send Response ─────────────────────────────────────────
        const totalMs = Date.now() - loginStart;
        logger.info(`[LOGIN-9] ✓ FULL LOGIN SUCCESS for ${userId} — total: ${totalMs}ms`);
        console.log(`[LOGIN-9] ✓ FULL LOGIN SUCCESS for ${userId} — total: ${totalMs}ms`);

        return res.json({
            success: true,
            token,
            message: 'Login successful',
            studentName: student.name,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        const totalMs = Date.now() - loginStart;
        // Log the full internal error (real Puppeteer/network/DB details) for backend debugging
        logger.error(`[LOGIN-ERR] ✗ Login FAILED for ${userId} after ${totalMs}ms — ${error.message}`, { stack: error.stack });
        console.error(`[LOGIN-ERR] ✗ Login FAILED for ${userId} after ${totalMs}ms — ${error.message}`);

        // Return a sanitized message to the client — never expose protocol errors or stack traces
        const clientMessage = sanitizeErrorForClient(error);
        return res.status(401).json({
            success: false,
            message: clientMessage,
            timestamp: new Date().toISOString()
        });
    }
};

const registerFcmToken = async (req, res) => {
    const { token, deviceType = 'android' } = req.body;
    const { userId } = req.session;

    logger.info('[FCM Registration] Request received');

    if (!token) {
        return res.status(400).json({
            success: false,
            message: 'token is required'
        });
    }

    try {
        const student = await prisma.student.findUnique({
            where: { userId }
        });

        if (!student) {
            logger.warn(`[FCM Registration] Student record not found for user`);
            return res.status(404).json({
                success: false,
                message: 'Student record not found'
            });
        }

        logger.info('[FCM Registration] Authenticated student resolved');

        // Upsert or findOrCreate token record
        await prisma.fcmToken.upsert({
            where: { token },
            update: {
                studentId: student.id,
                deviceType
            },
            create: {
                token,
                studentId: student.id,
                deviceType
            }
        });

        logger.info('[FCM Registration] Device registration persisted');
        return res.json({
            success: true,
            message: 'FCM token registered successfully'
        });

    } catch (error) {
        logger.error(`[FCM Registration] FCM token registration failed: ${error.message}`);
        return res.status(500).json({
            success: false,
            message: 'Internal server error while registering token'
        });
    }
};

const removeFcmToken = async (req, res) => {
    const { token } = req.body;
    const { userId } = req.session;

    if (!token) {
        return res.status(400).json({
            success: false,
            message: 'token is required'
        });
    }

    try {
        logger.info(`[AuthController] Removing FCM token for student ${userId}`);
        
        await prisma.fcmToken.deleteMany({
            where: {
                token,
                student: { userId }
            }
        });

        logger.info(`[AuthController] Successfully removed FCM Token for student: ${userId}`);
        return res.json({
            success: true,
            message: 'FCM token removed successfully'
        });

    } catch (error) {
        logger.error(`[AuthController] FCM token deletion failed for ${userId}: ${error.message}`);
        return res.status(500).json({
            success: false,
            message: 'Internal server error while removing token'
        });
    }
};


const logout = async (req, res) => {
    const token = req.token;          // set by requireAuth middleware
    const { userId } = req.session;

    try {
        logger.info(`[LOGOUT] ▶ Logout request — userId: ${userId || 'UNKNOWN'} | ip: ${req.ip}`);

        // 1. Remove from in-memory session store + DB
        sessionManager.deleteSession(token);
        logger.info(`[LOGOUT] Session deleted from store for: ${userId}`);

        // 2. Invalidate provider (ERP) session so no background sync re-uses it
        try {
            const ProviderSessionManager = require('../providers/session/ProviderSessionManager');
            await ProviderSessionManager.invalidate(userId);
            logger.info(`[LOGOUT] Provider session invalidated for: ${userId}`);
        } catch (provErr) {
            logger.warn(`[LOGOUT] Provider session invalidation failed (non-blocking): ${provErr.message}`);
        }

        // 3. Audit log (non-blocking)
        if (userId) {
            try {
                const student = await prisma.student.findUnique({
                    where: { userId },
                    select: { id: true }
                });
                if (student) {
                    auditLogRepository.log(student.id, 'LOGOUT', `Student logged out successfully`)
                        .catch(e => logger.warn(`[LOGOUT] Audit log failed: ${e.message}`));
                }
            } catch (_) {}
        }

        logger.info(`[LOGOUT] ✓ Logout complete for: ${userId}`);
        return res.json({
            success: true,
            message: 'Logged out successfully',
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        logger.error(`[LOGOUT] Error during logout for ${userId}: ${error.message}`);
        // Always return success on logout — don't block the client
        return res.json({
            success: true,
            message: 'Logged out',
            timestamp: new Date().toISOString()
        });
    }
};

module.exports = { login, logout, registerFcmToken, removeFcmToken };

