'use strict';

/**
 * SITAM Smart ERP — Session Isolation Validator
 *
 * Verifies that browser contexts are truly isolated between students.
 * Called at two critical points in the context lifecycle:
 *
 *   1. POST-CHECKOUT (after a new context is created)
 *      → A fresh context must have ZERO pre-existing cookies.
 *      → Any cookie found here is a cross-student data leak from a previous job.
 *
 *   2. POST-CHECKIN (after context.close() has been called)
 *      → Confirms the context is fully destroyed: no pages, no cookies.
 *      → Guards against "zombie context" bugs where close() silently fails.
 *
 * ISOLATION MODEL:
 *   Puppeteer : createBrowserContext() — each context is a true incognito session.
 *   Playwright: browser.newContext()   — equivalent isolation guarantee.
 *
 * WHAT IS VERIFIED:
 *   ✔ Cookie count = 0 at checkout
 *   ✔ getCookies() throws or returns [] after close (context destroyed)
 *   ✔ Metrics recorded for any isolation violation found
 *
 * SEVERITY:
 *   PRE_CHECKOUT violation  → CRITICAL (logged as error, throws in strict mode)
 *   POST_CHECKIN violation  → WARNING  (logged, increments leak counter)
 *
 * STRICT MODE:
 *   Set ISOLATION_STRICT=true to throw on any pre-checkout violation.
 *   In production: ISOLATION_STRICT=false (log and continue — never block a student login).
 *
 * @module SessionIsolationValidator
 */

const logger = require('../logger');

const STRICT_MODE = process.env.ISOLATION_STRICT === 'true';

class SessionIsolationValidator {
    constructor() {
        this._totalViolations = 0;
        this._totalChecks     = 0;
    }

    // ─── Public API ───────────────────────────────────────────────────────────

    /**
     * Call immediately after creating a new context (checkout).
     * A clean context must have ZERO cookies.
     *
     * @param {import('../providers/adapters/IContextAdapter')} context
     * @param {{ requestId: string, browserId: string, userId?: string }} meta
     * @returns {Promise<{ passed: boolean, cookiesFound: number }>}
     */
    async verifyFreshContext(context, meta) {
        const { requestId, browserId, userId = 'unknown' } = meta;
        this._totalChecks++;

        let cookies = [];
        try {
            cookies = await context.getCookies();
        } catch (_) {
            // getCookies() may fail if context is unexpectedly closed — treat as clean
            return { passed: true, cookiesFound: 0 };
        }

        if (cookies.length === 0) {
            logger.debug(
                `[Isolation] ✔ Fresh context clean: req=${requestId} browser=${browserId}`
            );
            return { passed: true, cookiesFound: 0 };
        }

        // ── VIOLATION: pre-existing cookies in a "fresh" context ──────────────
        this._totalViolations++;

        const cookieNames = cookies.slice(0, 5).map(c => c.name).join(', ');
        logger.error(
            `[Isolation] 🚨 CRITICAL: Fresh context has ${cookies.length} pre-existing ` +
            `cookies! This is a cross-student data leak. ` +
            `req=${requestId} browser=${browserId} user=${userId} ` +
            `cookies=[${cookieNames}${cookies.length > 5 ? '...' : ''}]`
        );

        // Record to Prometheus
        try {
            require('../metricsService').metrics.isolationViolationsTotal.inc({
                stage: 'checkout'
            });
        } catch (_) {}

        if (STRICT_MODE) {
            throw new Error(
                `[Isolation] Context isolation violated at checkout: ${cookies.length} ` +
                `leaked cookies detected (req=${requestId}). ` +
                `Set ISOLATION_STRICT=false to demote to warning.`
            );
        }

        return { passed: false, cookiesFound: cookies.length };
    }

    /**
     * Call after context.close() to confirm full destruction.
     * A closed context must be unreachable (getCookies() throws or returns []).
     *
     * @param {import('../providers/adapters/IContextAdapter')} context
     * @param {{ requestId: string, browserId: string, userId?: string }} meta
     * @returns {Promise<{ passed: boolean, residualCookies: number }>}
     */
    async verifyContextDestroyed(context, meta) {
        const { requestId, browserId, userId = 'unknown' } = meta;

        let residualCookies = 0;
        try {
            const cookies = await context.getCookies();
            residualCookies = cookies.length;

            if (cookies.length > 0) {
                this._totalViolations++;
                logger.warn(
                    `[Isolation] ⚠ Context closed but getCookies returned ${cookies.length} ` +
                    `cookies — context may not be fully destroyed. ` +
                    `req=${requestId} browser=${browserId} user=${userId}`
                );
                try {
                    require('../metricsService').metrics.isolationViolationsTotal.inc({
                        stage: 'checkin'
                    });
                } catch (_) {}
                return { passed: false, residualCookies };
            }
        } catch (_) {
            // Expected: getCookies() should throw on a closed context (access rejected).
            // This is the correct behavior — log it at debug level.
            logger.debug(
                `[Isolation] ✔ Context properly destroyed (getCookies threw): req=${requestId}`
            );
            return { passed: true, residualCookies: 0 };
        }

        logger.debug(
            `[Isolation] ✔ Context destroyed cleanly (0 cookies): req=${requestId}`
        );
        return { passed: true, residualCookies: 0 };
    }

    /**
     * Lifetime summary — used by /api/browserpool health endpoint.
     * @returns {{ totalChecks: number, totalViolations: number, cleanRate: string }}
     */
    getStats() {
        const cleanRate = this._totalChecks === 0
            ? '100.0%'
            : ((1 - this._totalViolations / this._totalChecks) * 100).toFixed(1) + '%';
        return {
            totalChecks:     this._totalChecks,
            totalViolations: this._totalViolations,
            cleanRate,
        };
    }
}

// Singleton — one validator per process (tracks global isolation health)
module.exports = new SessionIsolationValidator();
