const sessionManager = require('../services/sessionManager');
const { updateContext, logger } = require('../services/logger');

const requireAuth = (req, res, next) => {
    const { traceSpan } = require('../telemetry/tracing');
    return traceSpan('api.auth.validate', {}, async (span) => {
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            logger.warn('Token validation failed: Missing or invalid authorization header', { 
                tag: 'SECURITY_ALERT',
                ip: req.ip,
                url: req.originalUrl
            });
            span.setAttribute('auth.success', false);
            span.setAttribute('auth.reason', 'missing_header');
            span.setStatus({ code: 2, message: 'Missing or invalid authorization header' });
            return res.status(401).json({ error: 'Unauthorized: Missing or invalid token' });
        }

        const token = authHeader.split(' ')[1];
        const session = sessionManager.getSession(token);

        if (!session) {
            logger.warn('Token validation failed: Session expired or invalid', { 
                tag: 'SECURITY_ALERT',
                ip: req.ip,
                url: req.originalUrl,
                tokenPrefix: token.substring(0, 8)
            });
            span.setAttribute('auth.success', false);
            span.setAttribute('auth.reason', 'session_expired');
            span.setStatus({ code: 2, message: 'Session expired or invalid' });
            return res.status(401).json({ error: 'Unauthorized: Session expired or invalid' });
        }

        // Attach session data and token to request object for use in controllers
        req.session = session;
        req.token = token;

        // Dynamically bind authenticated userId to the request's tracing context
        updateContext({ userId: session.userId });

        span.setAttribute('auth.success', true);
        span.setAttribute('user.id', session.userId);

        next();
    });
};

module.exports = { requireAuth };
