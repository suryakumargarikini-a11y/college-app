/**
 * SITAM Smart ERP — Browser Stealth Hardening
 *
 * Applies anti-detection hardening to every new Puppeteer page.
 * Designed to make the automated browser behave like a real Chrome user,
 * reducing CAPTCHA trigger rates for legitimate authenticated student access.
 *
 * IMPORTANT:
 *   This is used ONLY for authenticated student ERP data access.
 *   Not intended for abusive or unauthorized scraping.
 *
 * TECHNIQUES:
 *   1. WebDriver flag masking   — navigator.webdriver = undefined
 *   2. Plugin array spoofing    — realistic navigator.plugins
 *   3. Chrome runtime injection — window.chrome = { runtime: {} }
 *   4. Permission query override— returns 'granted' (prevents bot fingerprint)
 *   5. Language/locale setting  — 'en-US' with India timezone
 *   6. Realistic typing         — human-like keystroke delays (25–80ms)
 *   7. Screen resolution spoof  — realistic viewport + screen properties
 */

'use strict';

const logger = require('../../../services/logger');

// Realistic modern Chrome user agents (updated periodically)
const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0'
];

// The JavaScript to inject into every page for stealth
const STEALTH_SCRIPT = `
(function() {
    // 1. Mask webdriver flag
    Object.defineProperty(navigator, 'webdriver', {
        get: () => undefined,
        configurable: true
    });

    // 2. Inject realistic plugins
    Object.defineProperty(navigator, 'plugins', {
        get: () => {
            const plugins = [
                { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
                { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
                { name: 'Native Client', filename: 'internal-nacl-plugin', description: '' }
            ];
            plugins.__proto__ = PluginArray.prototype;
            return plugins;
        },
        configurable: true
    });

    // 3. Inject Chrome runtime
    if (!window.chrome) {
        window.chrome = {
            runtime: {},
            loadTimes: function() {},
            csi: function() {},
            app: {}
        };
    }

    // 4. Fix permission query (bot detection checks this)
    if (navigator.permissions) {
        const originalQuery = navigator.permissions.query.bind(navigator.permissions);
        navigator.permissions.query = (parameters) => {
            if (parameters.name === 'notifications') {
                return Promise.resolve({ state: Notification.permission });
            }
            return originalQuery(parameters);
        };
    }

    // 5. Language and platform normalization
    Object.defineProperty(navigator, 'languages', {
        get: () => ['en-US', 'en'],
        configurable: true
    });

    // 6. Realistic screen properties
    if (window.screen) {
        try {
            Object.defineProperty(window.screen, 'availTop', { get: () => 0, configurable: true });
            Object.defineProperty(window.screen, 'availLeft', { get: () => 0, configurable: true });
        } catch (_) {}
    }

    // 7. Remove automation-related properties
    delete window.cdc_adoQpoasnfa76pfcZLmcfl_Array;
    delete window.cdc_adoQpoasnfa76pfcZLmcfl_Promise;
    delete window.cdc_adoQpoasnfa76pfcZLmcfl_Symbol;
})();
`;

class BrowserStealth {
    /**
     * Apply full stealth profile to a Puppeteer page.
     * Call this on every new page BEFORE any navigation.
     *
     * @param {import('puppeteer').Page} page
     * @param {{ userAgent?: string }} [opts]
     */
    async applyStealthProfile(page, opts = {}) {
        try {
            // Inject stealth overrides before any page script runs
            await page.evaluateOnNewDocument(STEALTH_SCRIPT);

            // Set realistic timezone
            await page.emulateTimezone('Asia/Kolkata').catch(() => {});

            logger.debug('[BrowserStealth] Stealth profile applied to page');
        } catch (err) {
            logger.warn(`[BrowserStealth] Stealth apply error (non-fatal): ${err.message}`);
        }
    }

    /**
     * Get a random realistic user agent.
     */
    getRandomUserAgent() {
        return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
    }

    /**
     * Type text into a field with human-like random delays (25–80ms per key).
     * Significantly more realistic than Puppeteer's default fixed-delay typing.
     *
     * @param {import('puppeteer').Page} page
     * @param {string} selector
     * @param {string} text
     * @param {{ clearFirst?: boolean }} [opts]
     */
    async typeWithHumanDelay(page, selector, text, opts = {}) {
        try {
            await page.focus(selector);
            if (opts.clearFirst) {
                await page.evaluate(sel => {
                    const el = document.querySelector(sel);
                    if (el) el.value = '';
                }, selector);
            }

            for (const char of text) {
                const delay = 25 + Math.floor(Math.random() * 55); // 25–80ms per key
                await page.keyboard.type(char, { delay });
            }
        } catch (err) {
            // Fallback to standard typing
            await page.type(selector, text, { delay: 40 });
        }
    }

    /**
     * Add a randomized human-like pause (simulates reading time).
     *
     * @param {number} baseMs
     * @param {number} [jitterMs]
     */
    async humanPause(baseMs = 500, jitterMs = 300) {
        const delay = baseMs + Math.floor(Math.random() * jitterMs);
        await new Promise(r => setTimeout(r, delay));
    }

    /**
     * Move mouse to element with a natural arc before clicking.
     * Falls back to direct click if element not found.
     *
     * @param {import('puppeteer').Page} page
     * @param {string} selector
     */
    async humanClick(page, selector) {
        try {
            const element = await page.$(selector);
            if (!element) { await page.click(selector); return; }

            const box = await element.boundingBox();
            if (!box) { await page.click(selector); return; }

            // Move to element with slight offset for realism
            const x = box.x + box.width  * (0.3 + Math.random() * 0.4);
            const y = box.y + box.height * (0.3 + Math.random() * 0.4);

            await page.mouse.move(x - 20, y - 10, { steps: 5 });
            await this.humanPause(50, 100);
            await page.mouse.move(x, y, { steps: 3 });
            await this.humanPause(50, 80);
            await page.mouse.click(x, y);

        } catch (err) {
            await page.click(selector).catch(() => {});
        }
    }
}

module.exports = new BrowserStealth();
