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
        msg.includes('check your credentials') || msg.includes('invalid user') ||
        msg.includes('authentication failed') || msg.includes('mock: invalid')) {
        return error.message; // intentionally pass through — user action required
    }

    // Captcha
    if (msg.includes('captcha')) {
        return 'SITAM ERP is showing a CAPTCHA. Please try again in a few minutes.';
    }

    // Provider unavailable
    if (msg.includes('unavailable') || msg.includes('erp system')) {
        return 'SITAM ERP is currently unavailable. Please try again shortly.';
    }

    // DB write failure
    if (msg.includes('db write failed') || msg.includes('upsert')) {
        return 'Login succeeded but your data could not be saved. Please try again.';
    }

    // Generic fallback — never expose stack traces or internal class names
    return 'Login failed. Please check your credentials and try again.';
}

// ─────────────────────────────────────────────────────────────────────────────
// LOGIN CONTROLLER
//
// SECURITY INVARIANTS (non-negotiable):
//   1. A JWT/session token is NEVER issued unless credentials are authenticated.
//   2. Authentication = either:
//        (a) The supplied password matches a verifiably-stored credential, OR
//        (b) The configured ERP provider explicitly accepts the credentials.
//   3. No Student DB record is created before authentication succeeds.
//   4. A password mismatch against the local cache does NOT fall through to
//      a successful login — the provider is called as the arbiter.
//   5. ERPUnavailableError → 503 (not 401, not a fake success).
//   6. AuthenticationError → 401, no token, no DB write.
// ─────────────────────────────────────────────────────────────────────────────
const login = async (req, res) => {
    const loginStart = Date.now();
    const rawUserId = (req.body.userId || '').trim();
    const password  = (req.body.password || '').trim();
    const requestId = req.requestId || 'no-req-id';

    logger.info(`[LOGIN-1] ▶ Request received — rawUserId: ${rawUserId || 'MISSING'} | requestId: ${requestId} | ip: ${req.ip}`);
    console.log(`[LOGIN-1] ▶ Request received — rawUserId: ${rawUserId || 'MISSING'} | requestId: ${requestId}`);

    if (!rawUserId || !password) {
        logger.warn(`[LOGIN-X] ✗ Validation failed — userId present: ${!!rawUserId}, password present: ${!!password}`);
        return res.status(400).json({
            success: false,
            message: 'userId and password are required',
            timestamp: new Date().toISOString()
        });
    }

    // Server-Side Parent Mode Detection:
    // Registration IDs ending with P/p indicate Parent Mode login.
    // Strip ONLY the trailing P/p to resolve the target student's account.
    const isParent  = /p$/i.test(rawUserId) || req.body.isParent === true;
    const userId    = rawUserId.replace(/p$/i, ''); // clean student ID for DB + session
    const userRole  = isParent ? 'PARENT' : 'STUDENT';

    try {
        const cacheService  = require('../services/cacheService');
        const cryptoHelper  = require('../services/cryptoHelper');
        const crypto        = require('crypto');
        const ProviderFactory = require('../providers/ProviderFactory');
        const { AuthenticationError, ERPUnavailableError, CaptchaDetectedError } = require('../providers/errors');

        // ── STAGE 2: Cache-First Student Lookup (<5ms / <150ms) ─────────────
        let cachedStudent = await cacheService.get('user_credentials', userId);

        if (cachedStudent) {
            logger.info(`[LOGIN-2] Memory cache HIT for: ${userId}`);
        } else {
            try {
                const dbLookupStart = Date.now();
                logger.info(`[LOGIN-2b] DB lookup for: ${userId} (isParent: ${isParent})`);

                const queryPromise = prisma.student.findUnique({ where: { userId } });
                const timerPromise = new Promise(r => setTimeout(() => r(null), 150));
                cachedStudent = await Promise.race([queryPromise, timerPromise]);

                logger.info(`[LOGIN-2b] DB lookup complete in ${Date.now() - dbLookupStart}ms — found: ${!!cachedStudent}`);

                if (cachedStudent) {
                    cacheService.set('user_credentials', userId, cachedStudent, 24 * 60 * 60 * 1000);
                }
            } catch (dbErr) {
                logger.warn(`[LOGIN-2b] DB lookup failed (${dbErr.message}) — will authenticate via provider`);
                cachedStudent = null;
            }
        }

        // ── STAGE 3: Credential Verification ─────────────────────────────────
        // INVARIANT: We only take the fast path (skip provider call) when we can
        // positively confirm the supplied password against a verifiably-stored
        // credential (AES-decrypted or HMAC-hashed).  Any other outcome triggers
        // provider.login() as the arbiter.  Falling through from a failed
        // comparison to a successful login is explicitly prevented.

        if (cachedStudent) {
            logger.info(`[LOGIN-3] Student found — verifying credentials locally for: ${userId}`);
            console.log(`[LOGIN-3] Student found — verifying credentials locally for: ${userId}`);

            // Check AES-encrypted credential (scraper-written path)
            let decryptedPassword = null;
            try {
                decryptedPassword = cryptoHelper.decrypt(cachedStudent.password);
            } catch (cryptoErr) {
                logger.warn(`[LOGIN-3] Decryption note for ${userId}: ${cryptoErr.message}`);
            }

            // Check HMAC-SHA256 credential (seed-demo.js / admin path)
            let hmacMatch = false;
            try {
                const saltsToTry = [
                    process.env.ADMIN_PASSWORD_SALT,
                    'sitam-admin-s4lt-ch4ng3-in-pr0ducti0n',
                    'sitam-admin-salt'
                ];
                for (const salt of new Set(saltsToTry)) {
                    if (!salt) continue;
                    const hmacHash = crypto.createHmac('sha256', salt).update(password).digest('hex');
                    if (cachedStudent.password === hmacHash) { hmacMatch = true; break; }
                }
            } catch (_) {}

            const localCredentialValid = (decryptedPassword === password) || hmacMatch;

            if (localCredentialValid) {
                // ── FAST PATH: local credential matches → no ERP call needed ──
                logger.info(`[LOGIN-3] ✓ Local credential match — issuing token for: ${userId} (role: ${userRole})`);
                console.log(`[LOGIN-3] ✓ Local credential match — instant login for: ${userId}`);

                const token = sessionManager.createSession(userId, password, 'cached_cookie', {
                    studentName: cachedStudent.name
                }, userRole, isParent);

                auditLogRepository.log(cachedStudent.id, isParent ? 'LOGIN_PARENT_INSTANT' : 'LOGIN_INSTANT',
                    `Instant login via verified cached credential (role: ${userRole})`)
                    .catch(e => logger.warn(`[LOGIN-3] Audit log failed: ${e.message}`));

                try {
                    const bc = getBusinessCollector();
                    if (bc) {
                        bc.trackActiveUser(userId).catch(() => {});
                        bc.trackFeatureAccess('login').catch(() => {});
                    }
                } catch (_) {}

                // Trigger background sync when data is stale, session is missing, or profile fields are incomplete
                const DEMO_MODE = (process.env.DEMO_MODE || '').toLowerCase() === 'true';
                const lastSync  = cachedStudent.lastSync;
                const isStale   = !lastSync || new Date(lastSync) < new Date(Date.now() - 30 * 60 * 1000);
                const hasSession = await ProviderSessionManager.hasValidSession(userId);
                const isIncomplete = !cachedStudent.branch || !cachedStudent.academicHistory;

                if (DEMO_MODE) {
                    logger.info(`[LOGIN-7] DEMO MODE — skipping background sync for: ${userId}`);
                } else if (isStale || !hasSession || isIncomplete) {
                    logger.info(`[LOGIN-7] Sync required (isStale:${isStale}, hasSession:${hasSession}, isIncomplete:${isIncomplete}) — triggering background sync for: ${userId}`);
                    syncService.triggerProviderSync(userId, password);
                } else {
                    logger.info(`[LOGIN-7] Data fresh & active session exists — skipping background sync for: ${userId}`);
                }

                const totalMs = Date.now() - loginStart;
                logger.info(`[LOGIN-OK] ✓ INSTANT LOGIN SUCCESS for ${userId} (role: ${userRole}) — ${totalMs}ms`);
                console.log(`[LOGIN-OK] ✓ INSTANT LOGIN SUCCESS for ${userId} — ${totalMs}ms`);

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
                // ── PROVIDER RE-VERIFICATION PATH ─────────────────────────────
                // The stored credential does NOT match the supplied password.
                // Possible reasons:
                //   1. Genuinely wrong password → provider will reject → 401
                //   2. Stored credential is stale/from broken flow → provider re-verifies
                // Either way: the ERP provider is the sole arbiter.
                // We do NOT fall through to login success from here.
                logger.warn(`[LOGIN-3] ✗ Local credential mismatch for: ${userId} — re-verifying with ERP provider`);
                console.log(`[LOGIN-3] ✗ Local mismatch — calling provider.login() to re-verify for: ${userId}`);

                const provider = ProviderFactory.getProvider();
                logger.info(`[LOGIN-3P] Using provider: ${provider.providerName} for re-verification of: ${userId}`);

                // Throws AuthenticationError if wrong password → caught below → 401
                // Throws ERPUnavailableError if ERP is down → caught below → 503
                const providerSession = await provider.login({ userId, password, requestId });

                logger.info(`[LOGIN-3P] ✓ Provider accepted credentials — updating stored credential for: ${userId}`);

                // Update the stored credential now that provider has verified it
                try {
                    const encryptedPassword = cryptoHelper.encrypt(password);
                    await prisma.student.update({ where: { userId }, data: { password: encryptedPassword } });
                    cacheService.del('user_credentials', userId); // invalidate stale cache
                    logger.info(`[LOGIN-3P] ✓ Credential updated in DB for: ${userId}`);
                } catch (updateErr) {
                    // Non-fatal — provider accepted, proceed with login
                    logger.warn(`[LOGIN-3P] Credential DB update failed (non-fatal) for ${userId}: ${updateErr.message}`);
                }

                // Trigger full background sync so real data is fetched
                syncService.triggerProviderSync(userId, password);

                const token = sessionManager.createSession(userId, password, providerSession.cookies || '', {
                    studentName: providerSession.studentName || cachedStudent.name
                }, userRole, isParent);

                auditLogRepository.log(cachedStudent.id, isParent ? 'LOGIN_PARENT_REVERIFIED' : 'LOGIN_REVERIFIED',
                    `Re-verified via ${provider.providerName} after local mismatch (role: ${userRole})`)
                    .catch(e => logger.warn(`[LOGIN-3P] Audit log failed: ${e.message}`));

                try {
                    const bc = getBusinessCollector();
                    if (bc) {
                        bc.trackActiveUser(userId).catch(() => {});
                        bc.trackFeatureAccess('login').catch(() => {});
                    }
                } catch (_) {}

                const totalMs = Date.now() - loginStart;
                logger.info(`[LOGIN-OK] ✓ REVERIFIED LOGIN SUCCESS for ${userId} (role: ${userRole}) — ${totalMs}ms`);
                console.log(`[LOGIN-OK] ✓ REVERIFIED LOGIN SUCCESS for ${userId} — ${totalMs}ms`);

                return res.json({
                    success: true,
                    token,
                    role: userRole,
                    isParent,
                    message: 'Login successful',
                    studentName: providerSession.studentName || cachedStudent.name,
                    timestamp: new Date().toISOString()
                });
            }

        } else {
            // ── STAGE 4: UNKNOWN STUDENT — Provider-First Authentication ──────
            // The student does not exist in our DB.
            // INVARIANT: provider.login() is called FIRST.
            //   - If it throws AuthenticationError → 401, no DB record created.
            //   - If it throws ERPUnavailableError → 503, no DB record created.
            //   - Only after provider.login() succeeds do we write to the DB.
            logger.info(`[LOGIN-4] Student not in DB — authenticating via provider FIRST for: ${userId}`);
            console.log(`[LOGIN-4] Student not in DB — calling provider.login() before any DB write for: ${userId}`);

            const provider = ProviderFactory.getProvider();
            logger.info(`[LOGIN-4P] Using provider: ${provider.providerName} for first-time login of: ${userId}`);

            // Throws on failure — no DB write happens
            const providerSession = await provider.login({ userId, password, requestId });

            logger.info(`[LOGIN-4P] ✓ Provider accepted credentials for new student: ${userId}`);

            // NOW safe to write DB record (authentication succeeded)
            let student;
            try {
                student = await studentRepository.upsertStudent(userId, {
                    name:     providerSession.studentName || userId,
                    password: password, // encrypted inside upsertStudent via cryptoHelper
                    roll:     userId,
                    section:  '',
                    program:  '',
                    branch:   ''
                    // Real profile fields (branch, semester, etc.) filled by background sync
                });
                logger.info(`[LOGIN-4P] ✓ Student record created/updated in DB for: ${userId}`);
            } catch (upsertErr) {
                logger.error(`[LOGIN-4P] DB upsert failed for ${userId}: ${upsertErr.message}`);
                // Provider authenticated but DB failed — ephemeral in-memory record only
                student = { id: userId, userId, name: providerSession.studentName || userId };
                logger.warn(`[LOGIN-4P] Using ephemeral record for: ${userId} (DB write failed — login still allowed)`);
            }

            // Cache for fast path on next login
            cacheService.set('user_credentials', userId, student, 24 * 60 * 60 * 1000);

            // Background full sync — fills attendance, marks, fees, real profile
            syncService.triggerProviderSync(userId, password);

            const token = sessionManager.createSession(userId, password, providerSession.cookies || '', {
                studentName: providerSession.studentName || student.name
            }, userRole, isParent);

            auditLogRepository.log(student.id, isParent ? 'LOGIN_PARENT_EXTERNAL' : 'LOGIN_EXTERNAL',
                `First-time login authenticated via ${provider.providerName} (role: ${userRole})`)
                .catch(e => logger.warn(`[LOGIN-4P] Audit log failed: ${e.message}`));

            try {
                const bc = getBusinessCollector();
                if (bc) {
                    bc.trackActiveUser(userId).catch(() => {});
                    bc.trackFeatureAccess('login').catch(() => {});
                }
            } catch (_) {}

            const totalMs = Date.now() - loginStart;
            logger.info(`[LOGIN-OK] ✓ FULL LOGIN SUCCESS for ${userId} (role: ${userRole}) — ${totalMs}ms`);
            console.log(`[LOGIN-OK] ✓ FULL LOGIN SUCCESS for ${userId} — ${totalMs}ms`);

            return res.json({
                success: true,
                token,
                role: userRole,
                isParent,
                message: 'Login successful',
                studentName: providerSession.studentName || student.name,
                timestamp: new Date().toISOString()
            });
        }

    } catch (error) {
        const totalMs = Date.now() - loginStart;
        logger.error(`[LOGIN-ERR] ✗ Login FAILED for ${userId} after ${totalMs}ms — ${error.message}`, { stack: error.stack });
        console.error(`[LOGIN-ERR] ✗ Login FAILED for ${userId} after ${totalMs}ms — ${error.message}`);

        // Select appropriate HTTP status
        const { AuthenticationError, ERPUnavailableError, CaptchaDetectedError } = require('../providers/errors');
        let httpStatus = 401;
        if (error instanceof ERPUnavailableError)  httpStatus = 503;
        if (error instanceof CaptchaDetectedError) httpStatus = 503;

        const clientMessage = sanitizeErrorForClient(error);
        return res.status(httpStatus).json({
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

        // 3. Invalidate data caches for userId
        if (userId) {
            try {
                const cacheService = require('../services/cacheService');
                cacheService.invalidate('user_credentials', userId);
                cacheService.invalidate('attendance', userId);
                cacheService.invalidate('profile', userId);
                cacheService.invalidate('marks', userId);
                cacheService.invalidate('fees', userId);
                cacheService.invalidate('assignments', userId);
                cacheService.invalidate('timetable', userId);
                cacheService.invalidate('academic_results', userId);
                logger.info(`[LOGOUT] Data caches invalidated for: ${userId}`);
            } catch (cErr) {
                logger.warn(`[LOGOUT] Cache invalidation note: ${cErr.message}`);
            }
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
