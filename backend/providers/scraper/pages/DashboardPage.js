'use strict';

/**
 * SITAM Smart ERP — DashboardPage
 *
 * Extracts student identity info from the post-login dashboard.
 *
 * Returns:
 *   {
 *     studentName: string,
 *     roll:        string,
 *     semester:    string,
 *     branch:      string,
 *     section:     string,
 *   }
 */

const { BasePage, PAGE_STATE } = require('./BasePage');

class DashboardPage extends BasePage {
    constructor(page, requestId, dashboardUrl) {
        super(page, requestId);
        this._url = dashboardUrl;
    }

    async extract() {
        this._setState(PAGE_STATE.LOADING);
        await this._page.goto(this._url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        this._setState(PAGE_STATE.READY);
        this._setState(PAGE_STATE.SCRAPING);

        const html = await this._page.content();

        const data = await this._page.evaluate(() => {
            const get = (sel) => document.querySelector(sel)?.textContent?.trim() || '';
            return {
                studentName: get('[id*="lblName"], [id*="Name"], .student-name') ||
                             get('h2, h3').replace(/^Hi[.\s]*/i, '').trim(),
                roll:        get('[id*="lblRoll"], [id*="Roll"], .roll-no'),
                semester:    get('[id*="lblSem"], [id*="Sem"], .semester'),
                branch:      get('[id*="lblBranch"], [id*="Branch"], .branch'),
                section:     get('[id*="lblSection"], [id*="Section"], .section'),
            };
        });

        this._setState(PAGE_STATE.SUCCESS);
        return { ...data, html };
    }
}

module.exports = DashboardPage;
