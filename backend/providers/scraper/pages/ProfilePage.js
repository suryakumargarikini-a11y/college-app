'use strict';

/**
 * SITAM Smart ERP — ProfilePage
 *
 * Extracts the student's full personal profile from the ERP.
 *
 * Returns:
 *   {
 *     html: string,  // raw HTML for the existing erpScraper parser
 *   }
 */

const { BasePage, PAGE_STATE } = require('./BasePage');

class ProfilePage extends BasePage {
    constructor(page, requestId, profileUrl) {
        super(page, requestId);
        this._url = profileUrl;
    }

    async extract() {
        this._setState(PAGE_STATE.LOADING);
        await this._page.goto(this._url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        this._setState(PAGE_STATE.READY);
        this._setState(PAGE_STATE.SCRAPING);

        await this._page.waitForSelector(
            'table, [id*="profile"], [id*="Profile"], form',
            { timeout: 15000 }
        ).catch(() => {});

        const html = await this._page.content();

        this._setState(PAGE_STATE.SUCCESS);
        return { html };
    }
}

module.exports = ProfilePage;
