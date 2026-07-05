const sessionManager = require('../services/sessionManager');
const { updateContext, logger } = require('../services/logger');

const requireAuth = async (req, res, next) => {
    const isFeesOrNotices = req.originalUrl && (req.originalUrl.includes('fees') || req.originalUrl.includes('fee-notices'));
    
    if (isFeesOrNotices) {
        console.log(`\n==================================================`);
        console.log(`[FEES-FLOW] [1] Middleware entry`);
        console.log(`[FEES-FLOW] Request URL: ${req.method} ${req.originalUrl}`);
        console.log(`[FEES-FLOW] Authorization header: ${req.headers.authorization || 'MISSING'}`);
    }

    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        if (isFeesOrNotices) {
            console.log(`[FEES-FLOW] ✗ Auth failed: Missing or invalid authorization header`);
            console.log(`==================================================\n`);
        }
        logger.warn('Token validation failed: Missing or invalid authorization header', { 
            tag: 'SECURITY_ALERT',
            ip: req.ip,
            url: req.originalUrl
        });
        return res.status(401).json({ error: 'Unauthorized: Missing or invalid token' });
    }

    const token = authHeader.split(' ')[1];
    
    if (isFeesOrNotices) {
        console.log(`[FEES-FLOW] Token: ${token}`);
        let decodedJwt = null;
        try {
            const jwt = require('jsonwebtoken');
            decodedJwt = jwt.decode(token);
        } catch (_) {}
        console.log(`[FEES-FLOW] Decoded JWT:`, decodedJwt ? JSON.stringify(decodedJwt) : 'N/A (UUID token)');
    }

    const session = await sessionManager.getSessionAsync(token);

    if (isFeesOrNotices) {
        console.log(`[FEES-FLOW] Session lookup result: ${session ? 'FOUND' : 'NOT FOUND'}`);
        if (session) {
            console.log(`[FEES-FLOW] Session userId: ${session.userId}`);
            console.log(`[FEES-FLOW] Session studentId: ${session.studentId || 'UNRESOLVED'}`);
        }
    }

    if (!session) {
        if (isFeesOrNotices) {
            console.log(`[FEES-FLOW] ✗ Auth failed: Session expired or invalid`);
            console.log(`==================================================\n`);
        }
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

    if (isFeesOrNotices) {
        console.log(`[FEES-FLOW] [2] Controller entry`);
        
        // Intercept response methods to capture status and body
        const originalJson = res.json;
        const originalSend = res.send;
        const originalStatus = res.status;
        
        let statusCode = 200;
        
        res.status = function(code) {
            statusCode = code;
            return originalStatus.apply(this, arguments);
        };
        
        res.json = function(body) {
            console.log(`[FEES-FLOW] [3] Controller exit via res.json`);
            console.log(`[FEES-FLOW] Response status: ${statusCode}`);
            console.log(`[FEES-FLOW] Response body:`, JSON.stringify(body));
            console.log(`==================================================\n`);
            return originalJson.apply(this, arguments);
        };
        
        res.send = function(body) {
            console.log(`[FEES-FLOW] [3] Controller exit via res.send`);
            console.log(`[FEES-FLOW] Response status: ${statusCode}`);
            const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
            console.log(`[FEES-FLOW] Response body:`, bodyStr.slice(0, 1000));
            console.log(`==================================================\n`);
            return originalSend.apply(this, arguments);
        };
    }

    next();
};

module.exports = { requireAuth };

