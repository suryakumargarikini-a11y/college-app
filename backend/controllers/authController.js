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

const login = async (req, res) => {
    const { userId, password } = req.body;

    if (!userId || !password) {
        return res.status(400).json({
            success: false,
            message: 'userId and password are required',
            timestamp: new Date().toISOString()
        });
    }

    try {
        logger.info(`[AuthController] Login request received for student: ${userId}`);

        // 1. Check if the student is already in our local database
        const cachedStudent = await prisma.student.findUnique({
            where: { userId }
        });

        // 2. If student exists and password matches, log in INSTANTLY (0.2s instead of 15s!)
        if (cachedStudent) {
            const cryptoHelper = require('../services/cryptoHelper');
            const decryptedPassword = cryptoHelper.decrypt(cachedStudent.password);
            
            if (decryptedPassword === password) {
                logger.info(`[AuthController] Instant login! Student credentials verified locally for: ${userId}`);
                
                // Create a session token using existing cached data
                // We simulate scrapedData structure from database
                const mockScrapedData = {
                    studentName: cachedStudent.name,
                    profileHtml: cachedStudent.address ? 'Cached' : '' // Trigger sync check if profile empty
                };

                const token = sessionManager.createSession(userId, password, 'cached_cookie', mockScrapedData);

                // Log successful event
                await auditLogRepository.log(cachedStudent.id, 'LOGIN_INSTANT', `Student logged in instantly via cached credentials`);

                // Track business metrics
                const bc = getBusinessCollector();
                if (bc) {
                    bc.trackActiveUser(userId).catch(() => {});
                    bc.trackFeatureAccess('login').catch(() => {});
                }

                // Trigger a background synchronization in the background!
                syncService.triggerProviderSync(userId, password);

                return res.json({
                    success: true,
                    token,
                    message: 'Login successful (instant cached)',
                    studentName: cachedStudent.name,
                    timestamp: new Date().toISOString()
                });
            }
        }

        // 3. First time login or password mismatch: run provider sync
        logger.info(`[AuthController] Credentials not cached or mismatch. Authenticating via provider layer for: ${userId}`);
        
        const student = await syncService.runProviderSync(userId, password, true);
        
        const providerSession = await ProviderSessionManager.acquire(userId);
        const cookies = providerSession ? providerSession.cookies : '';

        const token = sessionManager.createSession(userId, password, cookies, {
            studentName: student.name
        });

        await auditLogRepository.log(student.id, 'LOGIN_EXTERNAL', `Student successfully verified credentials and synced via Provider`);

        // Track business metrics
        const bc = getBusinessCollector();
        if (bc) {
            bc.trackActiveUser(userId).catch(() => {});
            bc.trackFeatureAccess('login').catch(() => {});
        }

        return res.json({
            success: true,
            token,
            message: 'Login successful',
            studentName: student.name,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        logger.error(`[AuthController] Login failed for ${userId}: ${error.message}`);
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
