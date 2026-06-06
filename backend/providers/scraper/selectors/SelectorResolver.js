/**
 * SITAM Smart ERP — Selector Resolver
 *
 * Traverses fallback selector chains to find the first working selector
 * on a live Puppeteer page. Integrates with telemetry and drift detection.
 *
 * USAGE:
 *   const resolver = require('./SelectorResolver');
 *   const { element, selector, depth } = await resolver.resolve(
 *     page, 'LOGIN_USERNAME', { timeout: 5000 }
 *   );
 */

'use strict';

const { ERP_SELECTORS } = require('./ERPSelectors');
const { SelectorDriftError } = require('../../errors');
const logger = require('../../../services/logger');
const providerMetrics = require('../../telemetry/ProviderMetrics');

const DEFAULT_TIMEOUT_PER_SELECTOR_MS = 3000;

class SelectorResolver {
    /**
     * Resolve a named selector key against a live Puppeteer page.
     * Tries each selector in the fallback chain until one succeeds.
     *
     * @param {import('puppeteer').Page} page
     * @param {string} selectorKey - Key from ERP_SELECTORS
     * @param {{ timeout?: number, required?: boolean, page?: string }} [options]
     * @returns {Promise<{ element: ElementHandle, selector: string, depth: number, confidence: number }>}
     */
    async resolve(page, selectorKey, options = {}) {
        const chain = ERP_SELECTORS[selectorKey];
        if (!chain || chain.length === 0) {
            throw new Error(`[SelectorResolver] Unknown selector key: "${selectorKey}"`);
        }

        const timeoutMs = options.timeout || DEFAULT_TIMEOUT_PER_SELECTOR_MS;
        const pageName  = options.page    || 'unknown';
        const required  = options.required !== false; // Default: required
        const attempted = [];

        for (let depth = 0; depth < chain.length; depth++) {
            const selector = chain[depth];
            try {
                const element = await page.waitForSelector(selector, {
                    timeout: timeoutMs,
                    visible:  true
                });

                if (element) {
                    // Record successful resolution
                    const confidence = this._computeConfidence(depth, chain.length);
                    providerMetrics.recordSelectorFallbackDepth('sitam-scraper', pageName, depth);

                    if (depth > 0) {
                        logger.warn(`[SelectorResolver] Key "${selectorKey}" resolved at depth ${depth} via "${selector}" (primary failed). Confidence: ${confidence}%`);
                        providerMetrics.recordSelectorFailure('sitam-scraper', chain[0], pageName);
                    } else {
                        logger.debug(`[SelectorResolver] Key "${selectorKey}" resolved at depth 0 via "${selector}"`);
                    }

                    return { element, selector, depth, confidence };
                }
            } catch (err) {
                attempted.push(selector);
                logger.debug(`[SelectorResolver] Selector "${selector}" failed (depth ${depth}): ${err.message}`);
            }
        }

        // All selectors failed
        if (required) {
            providerMetrics.recordSelectorFailure('sitam-scraper', chain[0], pageName);

            throw new SelectorDriftError(
                `All ${chain.length} selectors for "${selectorKey}" failed on page "${pageName}"`,
                {
                    selectorAttempts: attempted,
                    pageName,
                    providerName: 'sitam-scraper',
                    operationName: `resolve:${selectorKey}`
                }
            );
        }

        logger.warn(`[SelectorResolver] Key "${selectorKey}" not found (non-required). Continuing.`);
        return { element: null, selector: null, depth: -1, confidence: 0 };
    }

    /**
     * Check if an element exists on the page without throwing.
     * Useful for optional element detection (CAPTCHA checks, etc.)
     *
     * @param {import('puppeteer').Page} page
     * @param {string} selectorKey
     * @param {number} [timeoutMs]
     * @returns {Promise<boolean>}
     */
    async exists(page, selectorKey, timeoutMs = 2000) {
        const chain = ERP_SELECTORS[selectorKey];
        if (!chain) return false;

        for (const selector of chain) {
            try {
                const element = await page.waitForSelector(selector, { timeout: timeoutMs });
                if (element) return true;
            } catch (_) {}
        }
        return false;
    }

    /**
     * Compute confidence score based on fallback depth.
     * Depth 0 = 100%, each fallback reduces confidence.
     *
     * @param {number} depth
     * @param {number} chainLength
     * @returns {number} 0–100
     */
    _computeConfidence(depth, chainLength) {
        if (depth === 0) return 100;
        const penalty = depth / chainLength;
        return Math.max(10, Math.round((1 - penalty) * 100));
    }

    /**
     * Wait for content to be loaded in an element, trying multiple content div IDs.
     *
     * @param {import('puppeteer').Page} page
     * @param {string[]} divIds - Array of possible container IDs to check
     * @param {number} [timeoutMs]
     * @param {string} [requestId]
     * @returns {Promise<{ divId: string, loaded: boolean }>}
     */
    async waitForContentDiv(page, divIds, timeoutMs = 15000, requestId = 'unknown') {
        for (const divId of divIds) {
            try {
                const loaded = await page.waitForFunction(
                    (id) => {
                        const el = document.getElementById(id);
                        return el && el.innerText.trim().length > 20;
                    },
                    { timeout: timeoutMs },
                    divId
                );
                if (loaded) {
                    logger.info(`[SelectorResolver] [${requestId}] Content loaded in #${divId}`);
                    return { divId, loaded: true };
                }
            } catch (_) {}
        }
        logger.warn(`[SelectorResolver] [${requestId}] No content div found in: ${divIds.join(', ')}`);
        return { divId: null, loaded: false };
    }
}

module.exports = new SelectorResolver();
