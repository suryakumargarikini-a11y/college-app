const logger = require('../services/logger');
const { SessionExpiredError } = require('../providers/errors');

// Add standardized response helpers to the response object
const responseStandardizer = (req, res, next) => {
    res.ok = (data = null, message = 'Success', status = 200) => {
        return res.status(status).json({
            success: true,
            message,
            data,
            timestamp: new Date().toISOString()
        });
    };

    res.fail = (message = 'An error occurred', errorDetails = null, status = 400) => {
        logger.warn(`API Fail Response: ${message} | Details: ${JSON.stringify(errorDetails || {})}`);
        return res.status(status).json({
            success: false,
            message,
            error: errorDetails,
            timestamp: new Date().toISOString()
        });
    };

    next();
};

// Centralized error handling middleware
const errorHandler = (err, req, res, next) => {
    logger.error(`Unhandled API Error: ${err.message}`, { stack: err.stack });

    if (err instanceof SessionExpiredError) {
        return res.status(401).json({
            success: false,
            message: 'Session expired, please log in again.',
            error: 'SessionExpired',
            timestamp: new Date().toISOString()
        });
    }

    // Capture standard validation errors
    if (err.name === 'ValidationError' || err.isJoi) {
        return res.status(400).json({
            success: false,
            message: err.message || 'Validation failed',
            error: 'ValidationError',
            timestamp: new Date().toISOString()
        });
    }

    const statusCode = err.statusCode || 500;
    const clientMessage = statusCode === 500 ? 'Internal Server Error' : err.message;

    // ── Alert routing for 500-level errors ────────────────────────────────────
    // Route through the shared ObservabilityScheduler AlertRouter so alerts are
    // deduplicated and escalated consistently. Non-blocking — never delays response.
    if (statusCode >= 500) {
        try {
            const scheduler = require('../services/ObservabilityScheduler');
            const alertRouter = scheduler.getAlertRouter();
            if (alertRouter) {
                alertRouter.routeAlert({
                    service: 'API',
                    type:    err.code === 'ECONNREFUSED' ? 'db_error' : 'api_latency',
                    severity: 'P2',
                    message: `500-level error: ${err.message}`,
                    description: `Route: ${req.method} ${req.path} — ${err.stack || err.message}`
                });
            }
        } catch (_) { /* never block the error response */ }
    }

    return res.status(statusCode).json({
        success: false,
        message: clientMessage,
        error: process.env.NODE_ENV === 'production' ? 'InternalError' : err.stack,
        timestamp: new Date().toISOString()
    });
};

module.exports = {
    responseStandardizer,
    errorHandler
};
