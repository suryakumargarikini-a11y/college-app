'use strict';

/**
 * SITAM Smart ERP — Request ID Middleware
 *
 * Attaches a REQ-XXXXX correlation ID to every HTTP request/response.
 *
 * BEHAVIOUR:
 *   1. Reads `X-Request-ID` from the inbound request header.
 *      If the value is a valid REQ-XXXXX ID, it is reused (allows clients
 *      and upstream proxies to set their own ID for tracing).
 *   2. If no valid ID is present, generates a new one.
 *   3. Sets `X-Request-ID` on the outbound response header.
 *   4. Attaches the ID to `res.locals.requestId` for use in controllers.
 *   5. Enters the Winston AsyncLocalStorage logging context with requestId + userId
 *      so every log line in this request's async chain automatically carries the ID.
 *
 * USAGE (server.js):
 *   const requestIdMiddleware = require('./middleware/requestId');
 *   app.use(requestIdMiddleware);
 *
 * Then in any controller:
 *   const requestId = res.locals.requestId;  // "REQ-7F91A"
 *   return res.json({ requestId, ...data }); // ID in response body
 *
 * And the X-Request-ID header appears on every response automatically.
 *
 * @module middleware/requestId
 */

const { generate, coerce } = require('../services/requestId');
const { runWithContext } = require('../services/logger');

/**
 * Express middleware — attaches requestId to every request.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @param {Function}                   next
 */
function requestIdMiddleware(req, res, next) {
    // Accept a valid REQ-XXXXX from upstream, otherwise generate a fresh one
    const requestId = coerce(req.headers['x-request-id']);

    // Stamp the outbound response header immediately
    res.setHeader('X-Request-ID', requestId);

    // Make the ID available to all route handlers without prop-drilling
    res.locals.requestId = requestId;

    // Enter the logger's AsyncLocalStorage context so every logger.* call
    // in this request's async chain automatically emits the requestId.
    // userId is unknown at middleware time — controllers update it via
    // logger.updateContext({ userId }) once the student is identified.
    runWithContext({ requestId }, () => next());
}

module.exports = requestIdMiddleware;
