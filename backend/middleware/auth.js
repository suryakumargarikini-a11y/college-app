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

    // Attach session data and token to request object for use in controllers
    req.session = session;
    req.token = token;

    // Dynamically bind authenticated userId to the request's tracing context
    updateContext({ userId: session.userId });

    next();
};

module.exports = { requireAuth };
