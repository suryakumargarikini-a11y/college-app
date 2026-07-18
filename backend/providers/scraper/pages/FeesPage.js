'use strict';

/**
 * SITAM Smart ERP — FeesPage
 * Extracts fee ledger and payment history. Returns raw HTML for erpScraper parser.
 */

const { BasePage, PAGE_STATE } = require('./BasePage');

class FeesPage extends BasePage {
    constructor(page, requestId, feesUrl) {
        super(page, requestId);
        this._url = feesUrl;
    }

    async extract() {
        this._setState(PAGE_STATE.LOADING);
        await this._page.goto(this._url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        this._setState(PAGE_STATE.READY);
        this._setState(PAGE_STATE.SCRAPING);

        await this._page.waitForSelector(
            'table, [id*="fee"], [id*="Fee"], [id*="payment"], [id*="Payment"]',
            { timeout: 15000 }
        ).catch(() => {});

        const html = await this._page.content();
        this._setState(PAGE_STATE.SUCCESS);
        return { html };
    }
}

module.exports = FeesPage;
