'use strict';

/**
 * SITAM Smart ERP — AssignmentsPage
 * Extracts pending/submitted assignments list. Returns raw HTML for parser.
 */

const { BasePage, PAGE_STATE } = require('./BasePage');

class AssignmentsPage extends BasePage {
    constructor(page, requestId, assignmentsUrl) {
        super(page, requestId);
        this._url = assignmentsUrl;
    }

    async extract() {
        this._setState(PAGE_STATE.LOADING);
        await this._page.goto(this._url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        this._setState(PAGE_STATE.READY);
        this._setState(PAGE_STATE.SCRAPING);

        await this._page.waitForSelector(
            'table, [id*="assignment"], [id*="Assignment"]',
            { timeout: 15000 }
        ).catch(() => {});

        const html = await this._page.content();
        this._setState(PAGE_STATE.SUCCESS);
        return { html };
    }
}

module.exports = AssignmentsPage;
