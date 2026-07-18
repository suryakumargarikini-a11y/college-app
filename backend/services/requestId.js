'use strict';

/**
 * SITAM Smart ERP — Request ID Generator
 *
 * Generates short, human-readable correlation IDs in the format REQ-XXXXX.
 * These IDs propagate from the API layer through:
 *   BrowserPool → BrowserInstance → Session → SyncHistory → Logger → DebugCapture → API Response → X-Request-ID header
 *
 * One ID gives the complete flow for any operation. Example:
 *   REQ-7F91A → Login → Browser → Attendance → Profile → Marks → Fees → Completed
 *
 * FORMAT:
 *   "REQ-" + 5 uppercase alphanumeric chars (a-z, 0-9 → uppercased)
 *   Charset: 36^5 = ~60M unique values — collision-free for typical daily volume.
 *   Example: REQ-7F91A, REQ-B3KX2, REQ-MNZP0
 *
 * USAGE:
 *   const { generate, isValid } = require('./requestId');
 *   const requestId = generate();  // "REQ-7F91A"
 *   isValid(requestId);            // true
 *
 * @module requestId
 */

const PREFIX = 'REQ-';
const ID_LENGTH = 5;
const VALID_RE = /^REQ-[A-Z0-9]{5}$/;

/**
 * Generate a new request ID.
 * @returns {string}  e.g. "REQ-7F91A"
 */
function generate() {
    let id = '';
    // Math.random().toString(36) gives base-36 chars 0-9, a-z.
    // We slice characters until we have ID_LENGTH, then uppercase.
    while (id.length < ID_LENGTH) {
        id += Math.random().toString(36).slice(2).toUpperCase();
    }
    return PREFIX + id.slice(0, ID_LENGTH);
}

/**
 * Check whether a string matches the REQ-XXXXX format.
 * Useful for validating inbound X-Request-ID headers from clients.
 * @param {string} id
 * @returns {boolean}
 */
function isValid(id) {
    return typeof id === 'string' && VALID_RE.test(id);
}

/**
 * Coerce an arbitrary string to a valid request ID.
 * Returns the string if it's already valid; generates a new one otherwise.
 * Use when accepting X-Request-ID from upstream callers.
 * @param {string} [id]
 * @returns {string}
 */
function coerce(id) {
    return isValid(id) ? id : generate();
}

module.exports = { generate, isValid, coerce };
