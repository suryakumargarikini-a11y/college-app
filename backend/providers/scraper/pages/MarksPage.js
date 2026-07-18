'use strict';

/**
 * SITAM Smart ERP — MarksPage
 * Extracts semester-wise marks. Returns raw HTML for erpScraper parser.
 */

const { BasePage, PAGE_STATE } = require('./BasePage');

class MarksPage extends BasePage {
    constructor(page, requestId, marksUrl) {
        super(page, requestId);
        this._url = marksUrl;
    }

    async extract() {
        this._setState(PAGE_STATE.LOADING);
        await this._page.goto(this._url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        this._setState(PAGE_STATE.READY);
        this._setState(PAGE_STATE.SCRAPING);

        await this._page.waitForSelector(
            'table, [id*="marks"], [id*="Marks"], [id*="grade"], [id*="Grade"]',
            { timeout: 15000 }
        ).catch(() => {});

        const html = await this._page.content();
        this._setState(PAGE_STATE.SUCCESS);
        return { html };
    }
}

module.exports = MarksPage;
