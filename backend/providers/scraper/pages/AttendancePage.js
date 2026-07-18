'use strict';

/**
 * SITAM Smart ERP — AttendancePage
 *
 * Navigates to the ERP attendance tab and extracts subject-wise attendance data.
 *
 * Previously embedded inline inside the dashboard/sync flow.
 * Now a first-class page object with dedicated selector management and state machine.
 *
 * Returns:
 *   {
 *     subjects: Array<{
 *       name:       string,   // Subject name (e.g. "Data Structures")
 *       code:       string,   // Subject code (e.g. "CS-302")
 *       present:    number,   // Classes attended
 *       total:      number,   // Classes held
 *       percentage: number,   // (present / total) * 100
 *       status:     string,   // "Excellent" | "Good" | "Acceptable" | "Warning"
 *     }>,
 *     overallPercentage: number,
 *     html: string,   // raw page HTML for parser fallback
 *   }
 */

const { BasePage, PAGE_STATE } = require('./BasePage');

class AttendancePage extends BasePage {
    /**
     * @param {import('../../../services/browserPool/providers/adapters/IPageAdapter')} page
     * @param {string} requestId
     * @param {string} attendanceUrl  - Full URL to attendance tab/page
     */
    constructor(page, requestId, attendanceUrl) {
        super(page, requestId);
        this._url = attendanceUrl;
    }

    async extract() {
        this._setState(PAGE_STATE.LOADING);

        await this._page.goto(this._url, { waitUntil: 'domcontentloaded', timeout: 30000 });

        this._setState(PAGE_STATE.READY);
        this._setState(PAGE_STATE.SCRAPING);

        // Wait for the attendance table to appear
        await this._page.waitForSelector(
            'table, .attendance-table, #GridView1, [id*="attendance"], [id*="Attendance"]',
            { timeout: 15000 }
        ).catch(() => {});

        const html = await this._page.content();

        // Extract structured data via evaluate
        const subjects = await this._page.evaluate(() => {
            const rows = [];
            // Try common ERP attendance table selectors
            const tables = document.querySelectorAll('table');
            for (const table of tables) {
                const trs = table.querySelectorAll('tr');
                for (let i = 1; i < trs.length; i++) {  // skip header row
                    const cells = trs[i].querySelectorAll('td');
                    if (cells.length < 4) continue;

                    const name = cells[0]?.textContent?.trim() || '';
                    const code = cells[1]?.textContent?.trim() || name;

                    // Parse "present / total" or individual columns
                    let present = 0, total = 0, percentage = 0;

                    // Pattern A: "75/100" combined cell
                    const combined = cells[2]?.textContent?.trim() || '';
                    const combinedMatch = combined.match(/(\d+)\s*\/\s*(\d+)/);
                    if (combinedMatch) {
                        present = parseInt(combinedMatch[1], 10);
                        total   = parseInt(combinedMatch[2], 10);
                    } else {
                        // Pattern B: separate columns for present and total
                        present = parseInt(cells[2]?.textContent?.trim() || '0', 10);
                        total   = parseInt(cells[3]?.textContent?.trim() || '0', 10);

                        // Pattern C: percentage directly in a column
                        const pctCell = cells[4]?.textContent?.trim() || cells[3]?.textContent?.trim() || '';
                        const pctMatch = pctCell.match(/([\d.]+)\s*%/);
                        if (pctMatch) percentage = parseFloat(pctMatch[1]);
                    }

                    if (!name || total === 0) continue;
                    if (!percentage && total > 0) percentage = parseFloat(((present / total) * 100).toFixed(2));

                    const status = percentage >= 85 ? 'Excellent'
                                 : percentage >= 75 ? 'Good'
                                 : percentage >= 65 ? 'Acceptable'
                                 : 'Warning';

                    rows.push({ name, code, present, total, percentage, status });
                }
                if (rows.length > 0) break;  // stop after first successful table
            }
            return rows;
        });

        const overallPercentage = subjects.length > 0
            ? parseFloat((
                subjects.reduce((sum, s) => sum + s.percentage, 0) / subjects.length
              ).toFixed(2))
            : 0;

        this._setState(PAGE_STATE.SUCCESS);

        return { subjects, overallPercentage, html };
    }
}

module.exports = AttendancePage;
