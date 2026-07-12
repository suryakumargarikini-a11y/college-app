'use strict';

/**
 * Login Concurrency Queue — Admission Control for ERP Authentication
 *
 * Problem: 50 students logging in simultaneously all enter BrowserPool.acquire()
 * at once. Queue depth grows unboundedly and every request eventually times out
 * after 60 seconds rather than failing fast.
 *
 * Fix: A concurrency semaphore sitting ABOVE the BrowserPool. Controls how many
 * ERP logins run simultaneously. Excess requests wait in a bounded queue.
 * Overflow gets an immediate 503 instead of a 60-second timeout.
 *
 * Configuration (env vars):
 *   LOGIN_QUEUE_CONCURRENCY=3    max simultaneous ERP logins  (default: 3)
 *   LOGIN_QUEUE_MAX_WAIT=20      max queued waiting requests   (default: 20)
 *   LOGIN_QUEUE_TIMEOUT_MS=90000 per-request queue timeout     (default: 90s)
 */

const logger = require('../services/logger');

const MAX_CONCURRENT = parseInt(process.env.LOGIN_QUEUE_CONCURRENCY  || '3',  10);
const MAX_WAIT       = parseInt(process.env.LOGIN_QUEUE_MAX_WAIT      || '20', 10);
const TIMEOUT_MS     = parseInt(process.env.LOGIN_QUEUE_TIMEOUT_MS    || '90000', 10);

// Pool state
let _active = 0;
const _queue = [];

function _tryDequeue() {
    while (_active < MAX_CONCURRENT && _queue.length > 0) {
        const entry = _queue.shift();
        const waitedMs = Date.now() - entry.enqueuedAt;
        if (waitedMs >= TIMEOUT_MS) {
            logger.warn(`[LoginQueue] Timed out in queue (${waitedMs}ms) userId=${entry.userId}`);
            entry.reject(new Error('QUEUE_TIMEOUT'));
            continue;
        }
        _active++;
        logger.info(`[LoginQueue] Dequeued userId=${entry.userId} waited=${waitedMs}ms active=${_active}/${MAX_CONCURRENT}`);
        entry.resolve();
    }
}

function _release(userId) {
    _active = Math.max(0, _active - 1);
    logger.info(`[LoginQueue] Released userId=${userId} active=${_active}/${MAX_CONCURRENT} waiting=${_queue.length}`);
    _tryDequeue();
}

/** Returns current queue status for /api/metrics/dashboard */
function getStatus() {
    return { active: _active, waiting: _queue.length, max: MAX_CONCURRENT, maxWait: MAX_WAIT };
}

/**
 * Express middleware — apply only to POST /api/auth/login.
 * Usage in routes/auth.js:
 *   const loginQueue = require('../middleware/loginQueue');
 *   router.post('/login', loginQueue, login);
 */
async function loginQueueMiddleware(req, res, next) {
    const userId = (req.body && req.body.userId) || 'unknown';

    // Slot available — admit immediately
    if (_active < MAX_CONCURRENT) {
        _active++;
        logger.info(`[LoginQueue] Admitted userId=${userId} active=${_active}/${MAX_CONCURRENT}`);
        res.on('finish', () => _release(userId));
        res.on('close',  () => _release(userId));
        return next();
    }

    // Queue is full — reject immediately with 503
    if (_queue.length >= MAX_WAIT) {
        logger.warn(`[LoginQueue] Queue full (${_queue.length}/${MAX_WAIT}) rejecting userId=${userId}`);
        return res.status(503).json({
            success: false,
            message: 'Server is busy processing other login requests. Please try again in 30 seconds.',
            retryAfterSec: 30,
            timestamp: new Date().toISOString()
        });
    }

    // Enqueue with per-request timeout
    logger.info(`[LoginQueue] Queuing userId=${userId} active=${_active}/${MAX_CONCURRENT} waiting=${_queue.length + 1}/${MAX_WAIT}`);

    let timedOut = false;
    await new Promise((resolve, reject) => {
        let timer;
        const entry = {
            userId,
            enqueuedAt: Date.now(),
            resolve: () => { clearTimeout(timer); resolve(); },
            reject
        };
        _queue.push(entry);
        timer = setTimeout(() => {
            const idx = _queue.indexOf(entry);
            if (idx !== -1) _queue.splice(idx, 1);
            timedOut = true;
            reject(new Error('QUEUE_TIMEOUT'));
        }, TIMEOUT_MS);
    }).catch(err => {
        if (err.message !== 'QUEUE_TIMEOUT') throw err;
    });

    if (timedOut) {
        if (!res.headersSent) {
            return res.status(503).json({
                success: false,
                message: 'Login request timed out waiting for a server slot. Please try again.',
                retryAfterSec: 15,
                timestamp: new Date().toISOString()
            });
        }
        return;
    }

    if (res.headersSent) return;
    res.on('finish', () => _release(userId));
    res.on('close',  () => _release(userId));
    next();
}

loginQueueMiddleware.getStatus = getStatus;
module.exports = loginQueueMiddleware;
