'use strict';

/**
 * SITAM Smart ERP — TimetablePage
 * Extracts day-wise timetable grid. Returns raw HTML for parser.
 */

const { BasePage, PAGE_STATE } = require('./BasePage');

class TimetablePage extends BasePage {
    constructor(page, requestId, timetableUrl) {
        super(page, requestId);
        this._url = timetableUrl;
    }

    async extract() {
        this._setState(PAGE_STATE.LOADING);
        await this._page.goto(this._url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        this._setState(PAGE_STATE.READY);
        this._setState(PAGE_STATE.SCRAPING);

        await this._page.waitForSelector(
            'table, [id*="timetable"], [id*="Timetable"], [id*="schedule"], [id*="Schedule"]',
            { timeout: 15000 }
        ).catch(() => {});

        const html = await this._page.content();
        this._setState(PAGE_STATE.SUCCESS);
        return { html };
    }
}

module.exports = TimetablePage;
