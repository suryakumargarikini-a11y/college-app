const sessionManager = require('../services/sessionManager');
const { updateContext, logger } = require('../services/logger');

const requireAuth = async (req, res, next) => {
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
    
    // Use getSessionAsync to recover session from DB after Render cold starts
    // This prevents forced logouts when the in-memory session is cleared
    const session = await sessionManager.getSessionAsync(token);

    if (!session) {
        logger.warn('Token validation failed: Session expired or invalid', { 
            tag: 'SECURITY_ALERT',
            ip: req.ip,
            url: req.originalUrl,
            tokenPrefix: token.substring(0, 8)
        });
        return res.status(401).json({ error: 'Unauthorized: Session expired or invalid' });
    }

    // Resolve studentId (database UUID) from userId (roll number) dynamically and cache it in-memory
    if (!session.studentId && session.userId) {
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
    req.user = { id: session.studentId };
    req.session = session;
    req.token = token;

    // Dynamically bind authenticated userId to the request's tracing context
    updateContext({ userId: session.userId });

    next();
};

module.exports = { requireAuth };
