/**
 * SITAM Smart ERP — Circuit Breaker
 *
 * Protects the system from cascading failures when the external ERP
 * website (sitamecap.co.in) is slow or unreachable.
 *
 * States:
 *   CLOSED  — normal operation, all requests pass through
 *   OPEN    — ERP is down; requests fail fast without hitting Puppeteer
 *   HALF_OPEN — cooldown elapsed; one probe request allowed
 *
 * Thresholds (configurable via env):
 *   CIRCUIT_FAILURE_THRESHOLD = 5 consecutive failures → OPEN
 *   CIRCUIT_COOLDOWN_MS       = 60000ms (60s) before probing again
 */

const logger = require('./logger');

const FAILURE_THRESHOLD = parseInt(process.env.CIRCUIT_FAILURE_THRESHOLD || '5', 10);
const COOLDOWN_MS = parseInt(process.env.CIRCUIT_COOLDOWN_MS || '60000', 10);

const STATE = {
    CLOSED: 'CLOSED',
    OPEN: 'OPEN',
    HALF_OPEN: 'HALF_OPEN',
};

class CircuitBreaker {
    constructor(name = 'ERP') {
        this.name = name;
        this.state = STATE.CLOSED;
        this.failureCount = 0;
        this.lastFailureTime = null;
        this.cooldownMs = COOLDOWN_MS;
        this.successCount = 0; // Track successes in HALF_OPEN state
    }

    /**
     * Execute a function through the circuit breaker.
     * Throws immediately if circuit is OPEN.
     * Records success/failure to manage state transitions.
     *
     * @param {Function} fn - async function to execute
     * @param {string} requestId - correlation ID for logging
     * @returns {*} result of fn()
     */
    async execute(fn, requestId = 'unknown') {
        if (this.state === STATE.OPEN) {
            const elapsed = Date.now() - this.lastFailureTime;

            if (elapsed < this.cooldownMs) {
                const remainingSec = Math.round((this.cooldownMs - elapsed) / 1000);
                logger.warn(`[CircuitBreaker:${this.name}] [${requestId}] OPEN — rejecting fast. Cooldown: ${remainingSec}s remaining.`);
                // Import metrics lazily to avoid circular deps
                try { require('./metricsService').increment('circuit_breaker_rejected_total'); } catch (_) {}
                throw new Error(`ERP circuit breaker OPEN. Service unavailable for ~${remainingSec}s. Please retry later.`);
            }

            // Cooldown elapsed — transition to HALF_OPEN
            logger.info(`[CircuitBreaker:${this.name}] Transitioning OPEN → HALF_OPEN. Sending probe request...`, {
                tag: 'CIRCUIT_BREAKER_STATE_CHANGE',
                from: STATE.OPEN,
                to: STATE.HALF_OPEN
            });
            this.state = STATE.HALF_OPEN;
            try { require('./metricsService').metrics.circuitBreakerState.set({ breaker: this.name }, 0.5); } catch (_) {}
        }

        try {
            const result = await fn();
            this._onSuccess(requestId);
            return result;
        } catch (err) {
            this._onFailure(err, requestId);
            throw err;
        }
    }

    /**
     * Returns current breaker status for health/metrics endpoints.
     */
    getStatus() {
        return {
            name: this.name,
            state: this.state,
            failureCount: this.failureCount,
            cooldownMs: this.cooldownMs,
            lastFailureTime: this.lastFailureTime
                ? new Date(this.lastFailureTime).toISOString()
                : null,
        };
    }

    /**
     * Manually reset the circuit breaker (e.g. after confirmed ERP recovery).
     */
    reset() {
        logger.info(`[CircuitBreaker:${this.name}] Manual reset. State: ${this.state} → CLOSED`, {
            tag: 'CIRCUIT_BREAKER_STATE_CHANGE',
            from: this.state,
            to: STATE.CLOSED
        });
        this.state = STATE.CLOSED;
        try { require('./metricsService').metrics.circuitBreakerState.set({ breaker: this.name }, 0); } catch (_) {}
        this.failureCount = 0;
        this.lastFailureTime = null;
        this.cooldownMs = COOLDOWN_MS;
    }

    // ─── Private ──────────────────────────────────────────────────────────────

    _onSuccess(requestId) {
        if (this.state === STATE.HALF_OPEN) {
            logger.info(`[CircuitBreaker:${this.name}] Probe succeeded. Transitioning HALF_OPEN → CLOSED.`, {
                tag: 'CIRCUIT_BREAKER_STATE_CHANGE',
                from: STATE.HALF_OPEN,
                to: STATE.CLOSED
            });
            this.reset();
        } else {
            // Reset failure count on any success in CLOSED state
            if (this.failureCount > 0) {
                logger.info(`[CircuitBreaker:${this.name}] Success. Resetting failure count (was ${this.failureCount}).`);
                this.failureCount = 0;
            }
        }
    }

    _onFailure(err, requestId) {
        this.failureCount++;
        this.lastFailureTime = Date.now();

        logger.error(`[CircuitBreaker:${this.name}] Failure #${this.failureCount}/${FAILURE_THRESHOLD}: ${err.message}`, {
            tag: 'ERP_OUTAGE_FAILURE',
            failureCount: this.failureCount,
            error: err.message
        });

        if (this.state === STATE.HALF_OPEN) {
            // Probe failed — back to OPEN with doubled cooldown
            this.cooldownMs = Math.min(this.cooldownMs * 2, 5 * 60 * 1000); // max 5min
            this.state = STATE.OPEN;
            try {
                require('./metricsService').metrics.circuitBreakerState.set({ breaker: this.name }, 1);
                require('./metricsService').metrics.circuitBreakerFailuresTotal.inc({ breaker: this.name });
            } catch (_) {}
            logger.error(`[CircuitBreaker:${this.name}] Probe FAILED. Transitioning HALF_OPEN → OPEN. Extended cooldown: ${this.cooldownMs / 1000}s`, {
                tag: 'CIRCUIT_BREAKER_STATE_CHANGE',
                from: STATE.HALF_OPEN,
                to: STATE.OPEN,
                cooldownMs: this.cooldownMs
            });
            try { require('./metricsService').increment('circuit_breaker_open_total'); } catch (_) {}
            return;
        }

        if (this.failureCount >= FAILURE_THRESHOLD && this.state === STATE.CLOSED) {
            this.state = STATE.OPEN;
            try {
                require('./metricsService').metrics.circuitBreakerState.set({ breaker: this.name }, 1);
                require('./metricsService').metrics.circuitBreakerFailuresTotal.inc({ breaker: this.name });
            } catch (_) {}
            logger.error(`[CircuitBreaker:${this.name}] Threshold reached (${FAILURE_THRESHOLD} failures). Transitioning CLOSED → OPEN. Cooldown: ${this.cooldownMs / 1000}s`, {
                tag: 'CIRCUIT_BREAKER_STATE_CHANGE',
                from: STATE.CLOSED,
                to: STATE.OPEN,
                cooldownMs: this.cooldownMs
            });
            try { require('./metricsService').increment('circuit_breaker_open_total'); } catch (_) {}
        }
    }
}

// Singleton ERP circuit breaker
module.exports = new CircuitBreaker('ERP');
