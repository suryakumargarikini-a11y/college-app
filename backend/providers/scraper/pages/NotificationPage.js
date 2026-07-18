'use strict';

/**
 * SITAM Smart ERP — NotificationPage
 * Extracts unread notifications list from the ERP notification center.
 *
 * Returns: { html: string, notifications: Array<{ title, message, date }> }
 */

const { BasePage, PAGE_STATE } = require('./BasePage');

class NotificationPage extends BasePage {
    constructor(page, requestId, notificationUrl) {
        super(page, requestId);
        this._url = notificationUrl;
    }

    async extract() {
        this._setState(PAGE_STATE.LOADING);
        await this._page.goto(this._url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        this._setState(PAGE_STATE.READY);
        this._setState(PAGE_STATE.SCRAPING);

        await this._page.waitForSelector(
            'table, [id*="notif"], [id*="Notif"], [id*="message"], [id*="Message"]',
            { timeout: 15000 }
        ).catch(() => {});

        const html = await this._page.content();

        const notifications = await this._page.evaluate(() => {
            const items = [];
            document.querySelectorAll('table tr').forEach((tr, i) => {
                if (i === 0) return;  // skip header
                const cells = tr.querySelectorAll('td');
                if (cells.length < 2) return;
                items.push({
                    title:   cells[0]?.textContent?.trim() || '',
                    message: cells[1]?.textContent?.trim() || '',
                    date:    cells[2]?.textContent?.trim() || '',
                });
            });
            return items;
        });

        this._setState(PAGE_STATE.SUCCESS);
        return { html, notifications };
    }
}

module.exports = NotificationPage;
