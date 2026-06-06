/**
 * SITAM Smart ERP — Provider Error System
 *
 * Standardized, provider-independent error classes for all ERP integration failures.
 * These errors carry telemetry metadata, retry classification, and queue-safe
 * serialization so they can safely cross process boundaries via BullMQ.
 *
 * Design goals:
 *   - Provider code throws these; service layer catches and handles them
 *   - Each error carries: isRetryable, retryAfterMs, providerName, operationName
 *   - toJSON() for safe queue serialization / logging
 *   - fromJSON() for deserialization in worker processes
 */

'use strict';

// ─── Base Provider Error ──────────────────────────────────────────────────────

class ProviderError extends Error {
    /**
     * @param {string} message
     * @param {{ providerName?: string, operationName?: string, isRetryable?: boolean, retryAfterMs?: number, originalError?: Error, details?: object }} [options]
     */
    constructor(message, options = {}) {
        super(message);
        this.name          = this.constructor.name;
        this.providerName  = options.providerName  || 'unknown';
        this.operationName = options.operationName || 'unknown';
        this.isRetryable   = options.isRetryable   !== undefined ? options.isRetryable : false;
        this.retryAfterMs  = options.retryAfterMs  || 0;
        this.details       = options.details       || {};
        this.occurredAt    = new Date().toISOString();

        // Preserve original error chain
        if (options.originalError) {
            this.originalError        = options.originalError;
            this.originalErrorMessage = options.originalError.message;
            this.originalStack        = options.originalError.stack;
        }

        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, this.constructor);
        }
    }

    /**
     * Serialize to a plain object safe for JSON / queue transmission.
     * Strips circular references and non-serializable fields.
     */
    toJSON() {
        return {
            errorType:            this.name,
            message:              this.message,
            providerName:         this.providerName,
            operationName:        this.operationName,
            isRetryable:          this.isRetryable,
            retryAfterMs:         this.retryAfterMs,
            details:              this.details,
            occurredAt:           this.occurredAt,
            originalErrorMessage: this.originalErrorMessage || null,
        };
    }

    /**
     * Reconstruct a ProviderError from a serialized JSON object.
     * Used in worker processes after deserializing from BullMQ.
     * @param {object} obj
     * @returns {ProviderError}
     */
    static fromJSON(obj) {
        const map = {
            AuthenticationError:  AuthenticationError,
            SessionExpiredError:  SessionExpiredError,
            ERPUnavailableError:  ERPUnavailableError,
            RateLimitError:       RateLimitError,
            DataValidationError:  DataValidationError,
            SelectorDriftError:   SelectorDriftError,
            CaptchaDetectedError: CaptchaDetectedError,
        };
        const Cls = map[obj.errorType] || ProviderError;
        return new Cls(obj.message, {
            providerName:  obj.providerName,
            operationName: obj.operationName,
            details:       obj.details,
        });
    }
}

// ─── Specific Error Classes ────────────────────────────────────────────────────

/**
 * Thrown when student credentials are rejected by the ERP.
 * Not retryable — user must provide correct credentials.
 */
class AuthenticationError extends ProviderError {
    constructor(message = 'Authentication failed — invalid credentials', options = {}) {
        super(message, {
            isRetryable: false,
            retryAfterMs: 0,
            ...options
        });
    }
}

/**
 * Thrown when a previously valid session has expired.
 * Retryable via full re-login.
 */
class SessionExpiredError extends ProviderError {
    constructor(message = 'ERP session has expired — re-login required', options = {}) {
        super(message, {
            isRetryable: true,
            retryAfterMs: 0, // Retry immediately with new credentials
            ...options
        });
    }
}

/**
 * Thrown when the ERP portal is unreachable or returns non-200 responses.
 * Retryable with exponential backoff.
 */
class ERPUnavailableError extends ProviderError {
    constructor(message = 'ERP system is currently unavailable', options = {}) {
        super(message, {
            isRetryable: true,
            retryAfterMs: options.retryAfterMs || 30000, // Default: retry after 30s
            ...options
        });
    }
}

/**
 * Thrown when the provider receives HTTP 429 or detects rate limiting.
 * Retryable after the specified cool-down period.
 */
class RateLimitError extends ProviderError {
    constructor(message = 'ERP rate limit exceeded — requests throttled', options = {}) {
        super(message, {
            isRetryable: true,
            retryAfterMs: options.retryAfterMs || 60000, // Default: retry after 60s
            ...options
        });
    }
}

/**
 * Thrown when parsed ERP data fails the normalized model validation.
 * Not retryable — data structure needs investigation.
 * Triggers SRE alert for data quality degradation.
 */
class DataValidationError extends ProviderError {
    /**
     * @param {string} message
     * @param {{ validationErrors?: string[], modelName?: string }} [options]
     */
    constructor(message = 'ERP data failed normalized model validation', options = {}) {
        super(message, {
            isRetryable: false,
            details: {
                validationErrors: options.validationErrors || [],
                modelName:        options.modelName        || 'unknown',
                ...options.details
            },
            ...options
        });
    }
}

/**
 * Thrown when known CSS/ID selectors no longer match the ERP's DOM structure.
 * Indicates an ERP layout redesign — requires manual selector update.
 * Not retryable — triggers SRE degradation alert and Prometheus counter.
 */
class SelectorDriftError extends ProviderError {
    /**
     * @param {string} message
     * @param {{ selectorAttempts?: string[], pageName?: string }} [options]
     */
    constructor(message = 'ERP DOM structure changed — all selectors failed', options = {}) {
        super(message, {
            isRetryable: false,
            details: {
                selectorAttempts: options.selectorAttempts || [],
                pageName:         options.pageName         || 'unknown',
                ...options.details
            },
            ...options
        });
    }
}

/**
 * Thrown when the ERP serves a CAPTCHA challenge page.
 * Not retryable automatically — requires human intervention or provider logic upgrade.
 * Triggers SRE CAPTCHA frequency alert.
 */
class CaptchaDetectedError extends ProviderError {
    constructor(message = 'CAPTCHA challenge detected — automated access blocked', options = {}) {
        super(message, {
            isRetryable: false,
            retryAfterMs: 300000, // Wait 5 minutes before next attempt
            ...options
        });
    }
}

// ─── Error Classification Utilities ──────────────────────────────────────────

/**
 * Classify any error (including native errors) into a ProviderError.
 * Useful in catch blocks to normalize unexpected errors.
 *
 * @param {Error} err
 * @param {{ providerName?: string, operationName?: string }} [context]
 * @returns {ProviderError}
 */
function classifyError(err, context = {}) {
    if (err instanceof ProviderError) return err;

    const message = err.message || String(err);
    const lower   = message.toLowerCase();

    if (lower.includes('captcha') || lower.includes('challenge')) {
        return new CaptchaDetectedError(message, { originalError: err, ...context });
    }
    if (lower.includes('session') || lower.includes('cookie') || lower.includes('login page')) {
        return new SessionExpiredError(message, { originalError: err, ...context });
    }
    if (lower.includes('timeout') || lower.includes('econnrefused') || lower.includes('unreachable')) {
        return new ERPUnavailableError(message, { originalError: err, ...context });
    }
    if (lower.includes('rate limit') || lower.includes('429') || lower.includes('too many')) {
        return new RateLimitError(message, { originalError: err, ...context });
    }
    if (lower.includes('invalid credentials') || lower.includes('login failed') || lower.includes('authentication')) {
        return new AuthenticationError(message, { originalError: err, ...context });
    }
    if (lower.includes('selector') || lower.includes('dom') || lower.includes('element not found')) {
        return new SelectorDriftError(message, { originalError: err, ...context });
    }

    // Unknown — wrap in generic ProviderError, retryable by default for unknown failures
    return new ProviderError(message, { isRetryable: true, originalError: err, ...context });
}

module.exports = {
    ProviderError,
    AuthenticationError,
    SessionExpiredError,
    ERPUnavailableError,
    RateLimitError,
    DataValidationError,
    SelectorDriftError,
    CaptchaDetectedError,
    classifyError
};
