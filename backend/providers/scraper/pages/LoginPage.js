'use strict';

/**
 * SITAM Smart ERP — LoginPage
 *
 * Navigates to the ERP login page, fills credentials, submits, and
 * verifies successful authentication.
 *
 * Returns:
 *   {
 *     cookieString: string,          // "ASP.NET_SessionId=xxx; ..."
 *     cookies:      Array<object>,   // raw cookie array
 *     studentName:  string,          // extracted from post-login greeting
 *     postLoginUrl: string,          // URL after redirect (for validation)
 *   }
 *
 * Throws on:
 *   - Login page not reachable
 *   - Credentials invalid (still on Default.aspx after submit)
 *   - Selector not found after AdaptiveSelectorOptimizer exhausts chain
 */

const { BasePage, PAGE_STATE } = require('./BasePage');
const selectorOptimizer        = require('../selectors/AdaptiveSelectorOptimizer');
const maintDetector            = require('../maintenance/ERPMaintenanceDetector');
const antiBotDetector          = require('../antibot/AntiBotDetector');

class LoginPage extends BasePage {
    /**
     * @param {import('../../../services/browserPool/providers/adapters/IPageAdapter')} page
     * @param {string} requestId
     * @param {{ userId: string, password: string, loginUrl: string }} credentials
     */
    constructor(page, requestId, credentials) {
        super(page, requestId);
        this._userId   = credentials.userId;
        this._password = credentials.password;
        this._loginUrl = credentials.loginUrl;
    }

    async extract() {
        this._setState(PAGE_STATE.LOADING);

        // Navigate to the ERP login page
        try {
            await this._page.goto(this._loginUrl, { waitUntil: 'networkidle2', timeout: 60000 });
        } catch (navErr) {
            // One retry with same timeout (ERP can be slow to respond)
            await this._page.goto(this._loginUrl, { waitUntil: 'networkidle2', timeout: 60000 });
        }

        this._setState(PAGE_STATE.READY);

        // Maintenance and anti-bot checks (throw if detected)
        const maintResult = await maintDetector.detect(this._page);
        if (maintResult.detected) {
            this._setState(PAGE_STATE.FAILED);
            const { ERPUnavailableError } = require('../../errors');
            throw new ERPUnavailableError(`ERP under maintenance: ${maintResult.message}`, {
                providerName: 'sitam-scraper',
                operationName: 'login',
            });
        }
        await antiBotDetector.assertNoBotChallenge(this._page, {
            pageName: 'login',
            requestId: this._requestId,
        });

        this._setState(PAGE_STATE.SCRAPING);

        // Fill credentials using adaptive selector chain
        const usernameSel = await this._resolveSelector('LOGIN_USERNAME');
        await this._page.click(usernameSel);
        await this._page.type(usernameSel, this._userId, { delay: 30 });

        const passwordSel = await this._resolveSelector('LOGIN_PASSWORD');
        await this._page.click(passwordSel);
        await this._page.type(passwordSel, this._password, { delay: 30 });

        // Blur to trigger validation
        await this._page.evaluate((sel) => {
            const el = document.querySelector(sel);
            if (el) el.blur();
        }, passwordSel);

        await new Promise(r => setTimeout(r, 200));

        // Submit
        const loginBtnSel = await this._resolveSelector('LOGIN_BUTTON');
        await Promise.all([
            this._page.click(loginBtnSel),
            this._page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 40000 }),
        ]).catch(() => {}); // navigation promise may resolve before click settles

        await antiBotDetector.assertNoBotChallenge(this._page, {
            pageName: 'login_post',
            requestId: this._requestId,
        });

        const postLoginUrl = this._page.url();
        if (postLoginUrl.includes('Default.aspx')) {
            this._setState(PAGE_STATE.FAILED);
            throw new Error(
                `[LoginPage] Login failed — still on login page after submit. ` +
                `Check credentials for userId=${this._userId}`
            );
        }

        // Extract session cookies
        const cookies      = await this._page.cookies();
        const cookieString = cookies.map(c => `${c.name}=${c.value}`).join('; ');

        // Extract student name from post-login greeting
        let studentName = this._userId;
        try {
            const nameSel = await this._resolveSelector('LOGGED_IN_INDICATOR');
            const nameText = await this._page.evaluate((sel) => {
                const el = document.querySelector(sel);
                return el ? el.textContent : '';
            }, nameSel);
            studentName = nameText.replace(/^Hi[.\s]*/i, '').trim() || this._userId;
        } catch (_) {}

        this._setState(PAGE_STATE.SUCCESS);

        return { cookieString, cookies, studentName, postLoginUrl };
    }

    /** @private */
    async _resolveSelector(selectorKey) {
        const chain = await selectorOptimizer.getOptimizedChain(selectorKey);
        let lastErr = null;
        for (const selector of chain) {
            try {
                await this._page.waitForSelector(selector, { timeout: 10000 });
                await selectorOptimizer.recordOutcome(selectorKey, chain.indexOf(selector), true, this._page.url());
                return selector;
            } catch (err) {
                lastErr = err;
                await selectorOptimizer.recordOutcome(selectorKey, chain.indexOf(selector), false, this._page.url());
            }
        }
        const { SelectorDriftError } = require('../../errors');
        throw new SelectorDriftError(`LoginPage: failed to resolve selector ${selectorKey}`, {
            providerName: 'sitam-scraper',
            operationName: `login:${selectorKey}`,
            selectorAttempts: chain,
        });
    }
}

module.exports = LoginPage;
