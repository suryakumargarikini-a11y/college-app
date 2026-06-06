/**
 * SITAM Smart ERP — Adaptive Retry Classifier
 *
 * Maps provider errors to the correct retry strategy to prevent
 * destructive retry storms, CAPTCHA escalation, and ERP overload.
 *
 * Strategy chart:
 *   AuthenticationError   → halt, no retry (invalid creds)
 *   CaptchaDetectedError  → quarantine, no retry (worsen detection)
 *   SelectorDriftError    → alert ops, no retry (manual fix needed)
 *   SessionExpiredError   → full re-login retry
 *   RateLimitError        → long backoff, max 2 attempts
 *   ERPUnavailableError   → exponential backoff, max 3 attempts
 *   DataValidationError   → skip module, no retry
 *   Network/Timeout       → jitter backoff, max 2 attempts
 *   Unknown               → single cautious retry
 */

'use strict';

const logger = require('../../../services/logger');
const {
    ProviderError, AuthenticationError, SessionExpiredError, ERPUnavailableError,
    RateLimitError, DataValidationError, SelectorDriftError, CaptchaDetectedError,
    classifyError
} = require('../../errors');

const ACTIONS = {
    HALT:          'halt',
    RELOGIN:       'full_relogin',
    BACKOFF:       'backoff',
    JITTER_BACKOFF:'jitter_backoff',
    QUARANTINE:    'quarantine',
    ALERT:         'alert',
    SKIP_MODULE:   'skip_module'
};

class AdaptiveRetryClassifier {
    /**
     * Classify a caught error and return the retry strategy.
     *
     * @param {Error} error
     * @param {{ attempt?: number, userId?: string }} [ctx]
     * @returns {object} RetryStrategy
     */
    classify(error, ctx = {}) {
        const attempt      = ctx.attempt || 1;
        const providerErr  = (error instanceof ProviderError) ? error : classifyError(error);
        let strategy;

        if (providerErr instanceof AuthenticationError) {
            strategy = { action: ACTIONS.HALT,         retry: false, delayMs: 0,                                  maxAttempts: 1, notify: 'invalid_credentials' };
        } else if (providerErr instanceof CaptchaDetectedError) {
            strategy = { action: ACTIONS.QUARANTINE,   retry: false, delayMs: 0,                                  maxAttempts: 1, notify: 'captcha_detected'    };
        } else if (providerErr instanceof SelectorDriftError) {
            strategy = { action: ACTIONS.ALERT,        retry: false, delayMs: 0,                                  maxAttempts: 1, notify: 'selector_drift'      };
        } else if (providerErr instanceof SessionExpiredError) {
            strategy = { action: ACTIONS.RELOGIN,      retry: true,  delayMs: 1000,                               maxAttempts: 2, notify: null                  };
        } else if (providerErr instanceof RateLimitError) {
            strategy = { action: ACTIONS.BACKOFF,      retry: attempt <= 2, delayMs: 60000 + this._jitter(15000), maxAttempts: 2, notify: 'rate_limit'          };
        } else if (providerErr instanceof ERPUnavailableError) {
            strategy = { action: ACTIONS.BACKOFF,      retry: attempt <= 3, delayMs: this._expDelay(attempt, 30000), maxAttempts: 3, notify: attempt >= 3 ? 'erp_down' : null };
        } else if (providerErr instanceof DataValidationError) {
            strategy = { action: ACTIONS.SKIP_MODULE,  retry: false, delayMs: 0,                                  maxAttempts: 1, notify: null                  };
        } else {
            const isNet = this._isNetworkError(error);
            strategy = { action: isNet ? ACTIONS.JITTER_BACKOFF : ACTIONS.HALT, retry: isNet && attempt <= 2,
                         delayMs: isNet ? this._expDelay(attempt, 5000) : 0, maxAttempts: isNet ? 2 : 1, notify: null };
        }

        strategy.errorType    = providerErr.constructor.name;
        strategy.errorMessage = providerErr.message;
        strategy.isRetryable  = strategy.retry;
        strategy.attempt      = attempt;

        logger.debug(`[RetryClassifier] ${strategy.errorType} → action:${strategy.action} retry:${strategy.retry} delay:${strategy.delayMs}ms`);
        this._recordMetrics(strategy);
        return strategy;
    }

    /**
     * Compute final delay (with jitter cap at 2 minutes).
     */
    computeDelay(strategy, attemptNumber) {
        const base   = strategy.delayMs || 5000;
        const jitter = this._jitter(Math.min(base * 0.3, 10000));
        return Math.min(base + jitter, 120000);
    }

    /** Should this error type suppress the queue (prevent re-enqueue)? */
    shouldSuppressQueue(errorType) {
        return ['CaptchaDetectedError', 'SelectorDriftError', 'AuthenticationError'].includes(errorType);
    }

    summarize(strategy, userId = 'unknown') {
        return strategy.retry
            ? `[Retry] ${userId}: ${strategy.errorType} → ${strategy.action} in ${strategy.delayMs}ms (${strategy.attempt}/${strategy.maxAttempts})`
            : `[Retry] ${userId}: ${strategy.errorType} → ${strategy.action} (no retry)`;
    }

    // ─── Private ──────────────────────────────────────────────────────────────

    _expDelay(attempt, baseMs) {
        return Math.min(baseMs * Math.pow(2, attempt - 1), 120000);
    }

    _jitter(maxMs) {
        return Math.floor(Math.random() * Math.max(maxMs, 1));
    }

    _isNetworkError(err) {
        const m = err.message.toLowerCase();
        return m.includes('timeout') || m.includes('econnrefused') || m.includes('econnreset') ||
               m.includes('enotfound') || m.includes('network') || m.includes('navigation failed') ||
               m.includes('failed to fetch') || m.includes('protocol error');
    }

    _recordMetrics(strategy) {
        try {
            const m = require('../../telemetry/ProviderMetrics');
            m.recordRetryAttempt('sitam-scraper', strategy.errorType, strategy.action);
        } catch (_) {}
    }
}

module.exports = new AdaptiveRetryClassifier();
