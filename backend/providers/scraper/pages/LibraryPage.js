'use strict';

/**
 * SITAM Smart ERP — LibraryPage
 * Extracts borrowed books, due dates, and fines from the library portal.
 *
 * Returns: { html: string, books: Array }
 */

const { BasePage, PAGE_STATE } = require('./BasePage');

class LibraryPage extends BasePage {
    constructor(page, requestId, libraryUrl) {
        super(page, requestId);
        this._url = libraryUrl;
    }

    async extract() {
        this._setState(PAGE_STATE.LOADING);
        await this._page.goto(this._url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        this._setState(PAGE_STATE.READY);
        this._setState(PAGE_STATE.SCRAPING);

        await this._page.waitForSelector(
            'table, [id*="library"], [id*="Library"], [id*="book"], [id*="Book"]',
            { timeout: 15000 }
        ).catch(() => {});

        const html = await this._page.content();

        const books = await this._page.evaluate(() => {
            const rows = [];
            const trs  = document.querySelectorAll('table tr');
            for (let i = 1; i < trs.length; i++) {
                const cells = trs[i].querySelectorAll('td');
                if (cells.length < 2) continue;
                rows.push({
                    title:   cells[0]?.textContent?.trim() || '',
                    dueDate: cells[1]?.textContent?.trim() || '',
                    fine:    cells[2]?.textContent?.trim() || '0',
                });
            }
            return rows;
        });

        this._setState(PAGE_STATE.SUCCESS);
        return { html, books };
    }
}

module.exports = LibraryPage;
