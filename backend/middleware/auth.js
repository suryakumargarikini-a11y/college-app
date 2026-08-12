const sessionManager = require('../services/sessionManager');
const { updateContext, logger } = require('../services/logger');

const requireAuth = async (req, res, next) => {
    // P0-5: Removed [FEES-FLOW] diagnostic block that logged full Authorization header,
    // raw token UUID, decoded JWT payload, and full response bodies to Railway stdout.
    // The logger.warn calls below are retained — they log only safe metadata (no credentials).

    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        logger.warn('Token validation failed: Missing or invalid authorization header', { 
            tag: 'SECURITY_ALERT',
            ip: req.ip,
            url: req.originalUrl
        });
        return res.status(401).json({ error: 'Unauthorized: Missing or invalid token' });
    }

    const token = authHeader.split(' ')[1];

    let session = await sessionManager.getSessionAsync(token);

    if (!session) {
        try {
            const { verifyToken } = require('./adminAuth');
            const admin = verifyToken(token);
            if (admin) {
                const targetId = req.params.id;
                let studentDb = null;
                if (targetId) {
                    const db = require('../services/dbService');
                    studentDb = await db.student.findFirst({
                        where: { OR: [{ id: targetId }, { userId: targetId }] }
                    });
                }
                session = {
                    userId: studentDb ? studentDb.userId : (targetId || admin.email),
                    studentId: studentDb ? studentDb.id : targetId,
                    role: admin.role,
                    isAdmin: true
                };
            }
        } catch (_) {}
    }

    if (!session) {
        logger.warn('Token validation failed: Session expired or invalid', { 
            tag: 'SECURITY_ALERT',
            ip: req.ip,
            url: req.originalUrl,
            tokenPrefix: token.substring(0, 8)
        });
        return res.status(401).json({ error: 'Unauthorized: Session expired or invalid' });
    }

    // Resolve studentId (database UUID) from userId (roll number) dynamically and cache it in-memory.
    // BUG FIX: sessionManager.createSession() sets session.studentId = userId (roll number), not the DB UUID.
    // The original condition `!session.studentId` was always false (roll number is truthy), so UUID was never resolved.
    // Now we also trigger resolution when studentId is not a valid UUID (e.g., it's a roll number like 23B61A0449).
    const _uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const _studentIdIsUuid = session.studentId && _uuidPattern.test(session.studentId);
    if ((!session.studentId || !_studentIdIsUuid) && session.userId) {
        try {
            const db = require('../services/dbService');
            const student = await db.student.findUnique({
                where: { userId: session.userId },
                select: { id: true }
            });
            if (student) {
                session.studentId = student.id;
            }
        } catch (dbErr) {
            logger.error(`[AuthMiddleware] Failed to resolve student UUID for ${session.userId}: ${dbErr.message}`);
        }
    }

    // Attach compatibility objects for controllers expecting req.user or req.session.studentId
    req.user = { id: session.studentId || session.userId, userId: session.userId };
    req.session = session;
    req.token = token;

    // Dynamically bind authenticated userId to the request's tracing context
    updateContext({ userId: session.userId });

    next();
};

module.exports = { requireAuth };
