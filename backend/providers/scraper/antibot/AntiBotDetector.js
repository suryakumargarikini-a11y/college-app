/**
 * SITAM Smart ERP — Anti-Bot & CAPTCHA Detection System
 *
 * Classifies page content to detect anti-bot challenges BEFORE continuing
 * with scraping. Prevents infinite retry loops and browser pool poisoning.
 *
 * Detection Types:
 *   CAPTCHA            — image/reCAPTCHA/hCAPTCHA challenge pages
 *   CLOUDFLARE         — Cloudflare browser verification interstitials
 *   LOGIN_LOOP         — Redirected back to login after believing logged in
 *   RATE_LIMIT         — "Too many requests" or HTTP-429-style pages
 *   BLOCKED            — Explicit access denied or IP block pages
 *   MAINTENANCE        — Site maintenance / scheduled downtime pages
 *   SUSPICIOUS_REDIRECT— External domain redirect during authenticated session
 */

'use strict';

const logger = require('../../../services/logger');
const { CaptchaDetectedError, ERPUnavailableError } = require('../../errors');

const TEXT_PATTERNS = {
    CAPTCHA: [
        'please verify you are a human', 'prove you are not a robot',
        'solve this captcha', 'captcha required', 'complete the captcha',
        'security check', 'i am not a robot', "i'm not a robot",
        'enter the characters you see', 'type the characters'
    ],
    CLOUDFLARE: [
        'checking your browser', 'please wait while we check your browser',
        'cf-browser-verification', 'cloudflare', 'ddos protection by cloudflare',
        'browser check', 'just a moment', 'ray id'
    ],
    RATE_LIMIT: [
        'too many requests', 'rate limit exceeded',
        'you have sent too many requests', '429', 'request throttled',
        'quota exceeded', 'slow down'
    ],
    BLOCKED: [
        'access denied', 'your ip has been blocked',
        'you are not authorized to access', 'ip address has been blocked',
        'your access has been restricted', 'forbidden access'
    ],
    MAINTENANCE: [
        'site is under maintenance', "we'll be back soon", 'temporarily unavailable',
        'down for maintenance', 'scheduled maintenance', 'erp unavailable',
        'system is under maintenance', 'please try again later'
    ]
};

const CAPTCHA_SELECTORS = [
    'img[src*="captcha"]', 'img[src*="Captcha"]', 'img[alt*="captcha"]',
    'div.g-recaptcha', 'div.h-captcha', '.captcha-container',
    '[data-sitekey]', '#captchaDiv', 'input[name*="captcha"]',
    'iframe[src*="recaptcha"]', 'iframe[src*="hcaptcha"]'
];

const CLOUDFLARE_SELECTORS = [
    '#cf-browser-verification', '.cf-browser-verification',
    '#challenge-form', '#cf-challenge-form',
    '[data-translate="checking_browser"]'
];

class AntiBotDetector {
    /**
     * Detect anti-bot challenges on a Puppeteer page.
     * Call this after every page.goto() before proceeding.
     *
     * @param {import('puppeteer').Page} page
     * @param {string} [html] - Pre-fetched HTML (avoids extra page.content() call)
     * @param {{ userId?: string, requestId?: string, pageName?: string, expectedPage?: string }} [ctx]
     * @returns {Promise<{ detected: boolean, type: string|null, confidence: number, reason: string|null }>}
     */
    async detect(page, html, ctx = {}) {
        const requestId = ctx.requestId || 'unknown';
        const pageName  = ctx.pageName  || 'unknown';

        try {
            const pageUrl  = page.url();
            const pageHtml = html || await page.content();
            const lower    = pageHtml.toLowerCase();

            // 1. URL-based detection (fastest)
            const urlResult = this._detectByUrl(pageUrl, ctx);
            if (urlResult.detected) return this._log(urlResult, requestId, pageName);

            // 2. DOM selector detection (accurate)
            const domResult = await this._detectByDOM(page);
            if (domResult.detected) return this._log(domResult, requestId, pageName);

            // 3. Text pattern matching (broadest coverage)
            const textResult = this._detectByText(lower);
            if (textResult.detected) return this._log(textResult, requestId, pageName);

            return { detected: false, type: null, confidence: 0, reason: null };

        } catch (err) {
            logger.debug(`[AntiBotDetector] Detection error on "${pageName}": ${err.message}`);
            return { detected: false, type: null, confidence: 0, reason: null };
        }
    }

    /**
     * Detect and throw the appropriate ProviderError if a challenge is found.
     * Use as a guard immediately after page navigations.
     *
     * @param {import('puppeteer').Page} page
     * @param {object} [ctx]
     * @throws {CaptchaDetectedError|ERPUnavailableError}
     */
    async assertNoBotChallenge(page, ctx = {}) {
        const result = await this.detect(page, null, ctx);
        if (!result.detected) return;

        this._recordMetrics(result.type);

        if (result.type === 'CAPTCHA' || result.type === 'CLOUDFLARE') {
            throw new CaptchaDetectedError(
                `${result.type} detected on "${ctx.pageName || 'unknown'}": ${result.reason}`,
                { providerName: 'sitam-scraper', operationName: `navigate:${ctx.pageName || 'unknown'}` }
            );
        }

        throw new ERPUnavailableError(
            `ERP access restricted (${result.type}): ${result.reason}`,
            { providerName: 'sitam-scraper', operationName: `navigate:${ctx.pageName || 'unknown'}` }
        );
    }

    /**
     * Convenience check: is the current URL a login page when we expect to be elsewhere?
     */
    isLoginLoop(currentUrl, expectedPathFragment) {
        const onLogin = currentUrl.includes('Default.aspx') || currentUrl.toLowerCase().includes('login');
        return onLogin && expectedPathFragment && !currentUrl.includes(expectedPathFragment);
    }

    // ─── Private ──────────────────────────────────────────────────────────────

    _detectByUrl(url, ctx) {
        if (!url) return { detected: false };

        if (this.isLoginLoop(url, ctx.expectedPage)) {
            return { detected: true, type: 'LOGIN_LOOP', confidence: 95, reason: `Redirected to login: ${url}` };
        }
        if (url.includes('/blocked') || url.includes('/denied') || url.includes('/error/403')) {
            return { detected: true, type: 'BLOCKED', confidence: 90, reason: `Blocked URL: ${url}` };
        }
        return { detected: false };
    }

    async _detectByDOM(page) {
        for (const sel of CAPTCHA_SELECTORS) {
            try {
                if (await page.$(sel)) return { detected: true, type: 'CAPTCHA', confidence: 92, reason: `CAPTCHA element: ${sel}` };
            } catch (_) {}
        }
        for (const sel of CLOUDFLARE_SELECTORS) {
            try {
                if (await page.$(sel)) return { detected: true, type: 'CLOUDFLARE', confidence: 94, reason: `CF element: ${sel}` };
            } catch (_) {}
        }
        return { detected: false };
    }

    _detectByText(htmlLower) {
        for (const [type, patterns] of Object.entries(TEXT_PATTERNS)) {
            for (const pattern of patterns) {
                if (htmlLower.includes(pattern)) {
                    return { detected: true, type, confidence: 75, reason: `Text: "${pattern}"` };
                }
            }
        }
        return { detected: false };
    }

    _log(result, requestId, pageName) {
        logger.warn(`[AntiBotDetector] [${requestId}] ${result.type} on "${pageName}" (${result.confidence}%): ${result.reason}`);
        return result;
    }

    _recordMetrics(type) {
        try {
            const m = require('../../telemetry/ProviderMetrics');
            m.recordAntiBotEvent('sitam-scraper', type || 'UNKNOWN');
        } catch (_) {}
    }
}

module.exports = new AntiBotDetector();
