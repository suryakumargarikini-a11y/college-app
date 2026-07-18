'use strict';

/**
 * SITAM Smart ERP — ExitPassPage
 * Submits an exit pass request form and returns the pass details.
 *
 * Returns:
 *   {
 *     passId:  string,
 *     status:  string,
 *     message: string,
 *     html:    string,
 *   }
 */

const { BasePage, PAGE_STATE } = require('./BasePage');

class ExitPassPage extends BasePage {
    /**
     * @param {import('../../../services/browserPool/providers/adapters/IPageAdapter')} page
     * @param {string} requestId
     * @param {string} exitPassUrl
     * @param {{ reason: string, destination: string }} formData
     */
    constructor(page, requestId, exitPassUrl, formData = {}) {
        super(page, requestId);
        this._url      = exitPassUrl;
        this._formData = formData;
    }

    async extract() {
        this._setState(PAGE_STATE.LOADING);
        await this._page.goto(this._url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        this._setState(PAGE_STATE.READY);
        this._setState(PAGE_STATE.SCRAPING);

        const html = await this._page.content();

        this._setState(PAGE_STATE.SUCCESS);
        return { html };
    }
}

module.exports = ExitPassPage;
