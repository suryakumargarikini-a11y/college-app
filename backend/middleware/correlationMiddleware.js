/**
 * SITAM Smart ERP — Correlation ID & Trace Middleware
 *
 * Generates and propagates:
 *   - requestId: unique identifier for the current HTTP request
 *   - traceId: distributed tracing identifier (compatible with W3C traceparent)
 *   - correlationId: end-to-end user transaction flow identifier
 *
 * Runs the request within AsyncLocalStorage log context for automatic tag propagation.
 */

const { randomUUID } = require('crypto');
const { runWithContext } = require('../services/logger');
const { trace } = require('@opentelemetry/api');

const correlationMiddleware = (req, res, next) => {
    const requestId = req.headers['x-request-id'] || randomUUID();
    
    // Support custom trace headers or parse standard W3C traceparent
    let traceId = req.headers['x-trace-id'];
    
    // Prioritize active OpenTelemetry span context traceId
    try {
        const activeSpan = trace.getActiveSpan();
        if (activeSpan) {
            const spanContext = activeSpan.spanContext();
            if (spanContext && spanContext.traceId) {
                traceId = spanContext.traceId;
            }
        }
    } catch (_) {}

    if (!traceId) {
        const traceparent = req.headers['traceparent'];
        if (traceparent) {
            const parts = traceparent.split('-');
            if (parts.length >= 2) {
                traceId = parts[1]; // Extract traceId
            }
        }
    }
    if (!traceId) {
        // Fallback to random hex string (W3C trace ID format is 32-char hex)
        traceId = randomUUID().replace(/-/g, '');
    }

    const correlationId = req.headers['x-correlation-id'] || req.headers['x-request-id'] || requestId;

    // Attach to request object for easy internal reference
    req.requestId = requestId;
    req.traceId = traceId;
    req.correlationId = correlationId;

    // Echo back in response headers for client/SRE diagnostic visibility
    res.setHeader('X-Request-ID', requestId);
    res.setHeader('X-Trace-ID', traceId);
    res.setHeader('X-Correlation-ID', correlationId);

    // Initial context mapping
    const context = {
        requestId,
        traceId,
        correlationId,
        userId: null // Will be dynamically appended after authentication
    };

    // Run the downstream handlers inside the context boundary
    runWithContext(context, () => {
        next();
    });
};

module.exports = correlationMiddleware;
