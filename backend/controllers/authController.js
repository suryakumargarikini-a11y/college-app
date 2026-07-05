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
// LOGIN CONTROLLER — with per-stage timing + detailed diagnostic logs
// Every step is instrumented so logcat shows exactly where execution stops.
// ─────────────────────────────────────────────────────────────────────────────
const login = async (req, res) => {
    const loginStart = Date.now();
    const { userId, password } = req.body;
    const requestId = req.requestId || 'no-req-id';

    logger.info(`[LOGIN-1] ▶ Request received — userId: ${userId || 'MISSING'} | requestId: ${requestId} | ip: ${req.ip}`);
    console.log(`[LOGIN-1] ▶ Request received — userId: ${userId || 'MISSING'} | requestId: ${requestId}`);

    if (!userId || !password) {
        logger.warn(`[LOGIN-X] ✗ Validation failed — userId: ${!!userId}, password: ${!!password}`);
        return res.status(400).json({
            success: false,
            message: 'userId and password are required',
            timestamp: new Date().toISOString()
        });
    }

    try {
        // ── STAGE 2: Database Lookup ───────────────────────────────────────
        const dbLookupStart = Date.now();
        logger.info(`[LOGIN-2] DB lookup for student: ${userId}`);
        console.log(`[LOGIN-2] DB lookup for student: ${userId}`);

        const cachedStudent = await prisma.student.findUnique({
            where: { userId }
        });

        const dbLookupMs = Date.now() - dbLookupStart;
        logger.info(`[LOGIN-2] DB lookup complete in ${dbLookupMs}ms — found: ${!!cachedStudent}`);
        console.log(`[LOGIN-2] DB lookup complete in ${dbLookupMs}ms — found: ${!!cachedStudent}`);

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

            if (decryptedPassword === password) {
                logger.info(`[LOGIN-3] ✓ Credentials matched — instant login for: ${userId}`);
                console.log(`[LOGIN-3] ✓ Credentials matched — instant login for: ${userId}`);

                // ── STAGE 4: Session Token Creation ───────────────────────
                const sessionStart = Date.now();
                logger.info(`[LOGIN-4] Creating session token for: ${userId}`);
                console.log(`[LOGIN-4] Creating session token for: ${userId}`);

                const mockScrapedData = {
                    studentName: cachedStudent.name,
                    profileHtml: cachedStudent.address ? 'Cached' : ''
                };

                const token = sessionManager.createSession(userId, password, 'cached_cookie', mockScrapedData);
                const sessionMs = Date.now() - sessionStart;
                logger.info(`[LOGIN-4] Session token created in ${sessionMs}ms — token present: ${!!token}`);
                console.log(`[LOGIN-4] Session token created in ${sessionMs}ms — token present: ${!!token}`);

                // ── STAGE 5: Audit Log (non-blocking) ─────────────────────
                logger.info(`[LOGIN-5] Writing audit log for: ${userId}`);
                auditLogRepository.log(cachedStudent.id, 'LOGIN_INSTANT', `Student logged in instantly via cached credentials`)
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
                logger.info(`[LOGIN-7] Triggering background provider sync for: ${userId}`);
                console.log(`[LOGIN-7] Triggering background provider sync for: ${userId}`);
                syncService.triggerProviderSync(userId, password);

                // ── STAGE 8: Send Response ─────────────────────────────────
                const totalMs = Date.now() - loginStart;
                logger.info(`[LOGIN-8] ✓ INSTANT LOGIN SUCCESS for ${userId} — total: ${totalMs}ms`);
                console.log(`[LOGIN-8] ✓ INSTANT LOGIN SUCCESS for ${userId} — total: ${totalMs}ms`);

                return res.json({
                    success: true,
                    token,
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

        // ── STAGE 4: First-time / Password Mismatch — Provider Sync ──────────
        const providerSyncStart = Date.now();
        logger.info(`[LOGIN-4] Starting provider sync (ERP login + scraping) for: ${userId}`);
        console.log(`[LOGIN-4] Starting provider sync (ERP login + scraping) for: ${userId}`);

        const student = await syncService.runProviderSync(userId, password, true);

        const providerSyncMs = Date.now() - providerSyncStart;
        logger.info(`[LOGIN-4] ✓ Provider sync complete in ${providerSyncMs}ms — student: ${student?.name}`);
        console.log(`[LOGIN-4] ✓ Provider sync complete in ${providerSyncMs}ms — student: ${student?.name}`);

        // ── STAGE 5: Acquire Provider Session ──────────────────────────────
        const sessionAcqStart = Date.now();
        logger.info(`[LOGIN-5] Acquiring provider session for: ${userId}`);
        console.log(`[LOGIN-5] Acquiring provider session for: ${userId}`);

        const providerSession = await ProviderSessionManager.acquire(userId);
        const cookies = providerSession ? providerSession.cookies : '';
        const sessionAcqMs = Date.now() - sessionAcqStart;
        logger.info(`[LOGIN-5] Provider session acquired in ${sessionAcqMs}ms — cookies present: ${!!cookies}`);
        console.log(`[LOGIN-5] Provider session acquired in ${sessionAcqMs}ms — cookies present: ${!!cookies}`);

        // ── STAGE 6: Create JWT Session ────────────────────────────────────
        const jwtStart = Date.now();
        logger.info(`[LOGIN-6] Creating JWT session for: ${userId}`);
        console.log(`[LOGIN-6] Creating JWT session for: ${userId}`);

        const token = sessionManager.createSession(userId, password, cookies, {
            studentName: student.name
        });
        const jwtMs = Date.now() - jwtStart;
        logger.info(`[LOGIN-6] JWT created in ${jwtMs}ms — token present: ${!!token}`);
        console.log(`[LOGIN-6] JWT created in ${jwtMs}ms — token present: ${!!token}`);

        // ── STAGE 7: Audit Log (non-blocking) ─────────────────────────────
        auditLogRepository.log(student.id, 'LOGIN_EXTERNAL', `Student successfully verified credentials and synced via Provider`)
            .catch(e => logger.warn(`[LOGIN-7] Audit log failed (non-blocking): ${e.message}`));

        // ── STAGE 8: Business Metrics (non-blocking) ──────────────────────
        try {
            const bc = getBusinessCollector();
            if (bc) {
                bc.trackActiveUser(userId).catch(() => {});
                bc.trackFeatureAccess('login').catch(() => {});
            }
        } catch (_) {}

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
        logger.error(`[LOGIN-ERR] ✗ Login FAILED for ${userId} after ${totalMs}ms — ${error.message}`, { stack: error.stack });
        console.error(`[LOGIN-ERR] ✗ Login FAILED for ${userId} after ${totalMs}ms — ${error.message}`);
        console.error(`[LOGIN-ERR] Stack: ${error.stack}`);
        return res.status(401).json({
            success: false,
            message: error.message || 'Login failed. Please check your credentials.',
            timestamp: new Date().toISOString()
        });
    }
};

const registerFcmToken = async (req, res) => {
    const { token, deviceType = 'android' } = req.body;
    const { userId } = req.session;

    if (!token) {
        return res.status(400).json({
            success: false,
            message: 'token is required'
        });
    }

    try {
        logger.info(`[AuthController] Registering FCM token for student ${userId}`);
        const student = await prisma.student.findUnique({
            where: { userId }
        });

        if (!student) {
            return res.status(404).json({
                success: false,
                message: 'Student record not found'
            });
        }

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

        logger.info(`[AuthController] Successfully registered FCM Token for student: ${userId}`);
        return res.json({
            success: true,
            message: 'FCM token registered successfully'
        });

    } catch (error) {
        logger.error(`[AuthController] FCM token registration failed for ${userId}: ${error.message}`);
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

module.exports = { login, registerFcmToken, removeFcmToken };
