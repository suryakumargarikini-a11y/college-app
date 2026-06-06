/**
 * SITAM Smart ERP — Puppeteer Service (Browser Pool Edition)
 *
 * Replaces one-shot browser launches with the shared BrowserPool.
 * Every student sync job gets:
 *   - A pre-warmed, reusable browser instance (eliminates 3-8s cold start)
 *   - An isolated incognito context (zero cross-student cookie leakage)
 *   - Circuit breaker protection (fast-fail if ERP is down)
 */

const fs = require('fs');
const path = require('path');
const browserPool = require('./browserPool');
const circuitBreaker = require('./circuitBreaker');
const logger = require('./logger');

class PuppeteerService {
    constructor() {
        this.baseUrl = process.env.ERP_BASE_URL;
        this.siteBase = this.baseUrl ? this.baseUrl.split('/SATYA')[0] : '';
        this.debugDir = path.join(__dirname, '..');
    }

    _saveDebug(name, html) {
        try {
            fs.writeFileSync(path.join(this.debugDir, `debug_${name}_latest.html`), html, 'utf8');
        } catch (e) { /* ignore */ }
    }

    async _recordNavigationTimings(page, span, stepName) {
        try {
            const timing = await page.evaluate(() => {
                const t = window.performance.timing;
                return {
                    dns: t.domainLookupEnd - t.domainLookupStart,
                    tcp: t.connectEnd - t.connectStart,
                    request: t.responseEnd - t.requestStart,
                    dom: t.domContentLoadedEventEnd - t.navigationStart,
                    load: t.loadEventEnd - t.navigationStart
                };
            });
            span.addEvent(`${stepName}_navigation_timing`, timing);
            span.setAttribute(`${stepName}.dns_resolution_ms`, timing.dns);
            span.setAttribute(`${stepName}.tcp_connection_ms`, timing.tcp);
            span.setAttribute(`${stepName}.dom_content_loaded_ms`, timing.dom);
            span.setAttribute(`${stepName}.page_load_ms`, timing.load);
        } catch (_) {}
    }

    async _waitForContent(page, divId, timeout = 15000, requestId = 'unknown') {
        try {
            await page.waitForFunction(
                (id) => {
                    const el = document.getElementById(id);
                    return el && el.innerText.trim().length > 20;
                },
                { timeout },
                divId
            );
            logger.info(`[Puppeteer] [${requestId}] Content loaded in #${divId}`);
            return true;
        } catch (e) {
            logger.warn(`[Puppeteer] [${requestId}] Timeout waiting for #${divId}`);
            return false;
        }
    }

    /**
     * Login to the ERP and scrape all academic panels for a student.
     * Uses browser pool for reuse and circuit breaker for outage protection.
     */
    async login(userId, password, requestId = 'unknown') {
        // Circuit breaker guard — fast-fail if ERP is known to be down
        return circuitBreaker.execute(async () => {
            return this._loginWithPool(userId, password, requestId);
        }, requestId);
    }

    async _loginWithPool(userId, password, requestId) {
        const startAcquire = Date.now();
        return traceSpan('puppeteer.erp.sync', {
            'user.id': userId,
            'dependency.type': 'external',
            'dependency.name': 'sitam_erp',
            'dependency.category': 'academic_platform',
            'dependency.criticality': 'high'
        }, async (parentSpan) => {
            const startTime = Date.now();
            let browserId = null;
            let context = null;
            let page = null;

            try {
                logger.info(`[Puppeteer] [${requestId}] Acquiring browser from pool for: ${userId}`);
                parentSpan.addEvent('browser_acquire_started');

                // Acquire a pre-warmed browser with a fresh isolated context
                ({ browserId, context } = await browserPool.acquire(requestId));

                const acquireDuration = Date.now() - startAcquire;
                parentSpan.setAttribute('browser.acquire_delay_ms', acquireDuration);
                parentSpan.addEvent('browser_acquire_success', { browserId, acquire_delay_ms: acquireDuration });

                logger.info(`[Puppeteer] [${requestId}] Pool acquired browser ${browserId} in ${Date.now() - startTime}ms`);

                // Open a page inside the isolated context
                page = await context.newPage();
                await page.setViewport({ width: 1280, height: 800 });
                await page.setUserAgent(
                    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                );

                // ====== LOGIN ======
                await traceSpan('puppeteer.erp.login', {
                    'dependency.type': 'external',
                    'dependency.name': 'sitam_erp',
                    'dependency.category': 'academic_platform',
                    'dependency.criticality': 'high'
                }, async (loginSpan) => {
                    loginSpan.addEvent('erp_login_started');
                    const loginUrl = `${this.siteBase}/SATYA/Default.aspx`;
                    logger.info(`[Puppeteer] [${requestId}] Navigating to login: ${loginUrl}`);
                    await page.goto(loginUrl, { waitUntil: 'networkidle2', timeout: 30000 });
                    await page.waitForSelector('#txtId2', { timeout: 10000 });

                    await page.click('#txtId2');
                    await page.type('#txtId2', userId, { delay: 30 });
                    await page.click('#txtPwd2');
                    await page.type('#txtPwd2', password, { delay: 30 });
                    await page.evaluate(() => document.getElementById('txtPwd2').blur());
                    await new Promise(r => setTimeout(r, 500));

                    logger.info(`[Puppeteer] [${requestId}] Submitting login...`);
                    await Promise.all([
                        page.click('#imgBtn2'),
                        page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 20000 })
                    ]).catch(e => logger.info(`[Puppeteer] [${requestId}] Nav note: ${e.message}`));

                    await this._recordNavigationTimings(page, loginSpan, 'login');

                    const pageUrl = page.url();
                    logger.info(`[Puppeteer] [${requestId}] Post-login URL: ${pageUrl}`);
                    if (pageUrl.includes('Default.aspx')) {
                        throw new Error('Login failed — still on login page. Check credentials.');
                    }
                    loginSpan.addEvent('erp_login_success');
                });

                // ====== COOKIES ======
                const browserCookies = await page.cookies();
                const cookieString = browserCookies.map(c => `${c.name}=${c.value}`).join('; ');
                logger.info(`[Puppeteer] [${requestId}] Cookies (${browserCookies.length}): ${browserCookies.map(c => c.name).join(', ')}`);

                if (!cookieString.includes('ASP.NET_SessionId')) {
                    logger.warn(`[Puppeteer] [${requestId}] WARNING: No ASP.NET_SessionId in cookies!`);
                }

                const scrapedData = {};

                // 1. Student name
                try {
                    const nameText = await page.evaluate(() => {
                        const el = document.getElementById('lblUser');
                        return el ? el.textContent : '';
                    });
                    scrapedData.studentName = nameText.replace(/^Hi[\.\s]*/i, '').trim();
                    logger.info(`[Puppeteer] [${requestId}] Name: "${scrapedData.studentName}"`);
                } catch (e) { scrapedData.studentName = userId; }

                // 2. Profile
                await traceSpan('puppeteer.erp.scrapeProfile', {
                    'dependency.type': 'external',
                    'dependency.name': 'sitam_erp',
                    'dependency.category': 'academic_platform',
                    'dependency.criticality': 'high'
                }, async (profileSpan) => {
                    try {
                        logger.info(`[Puppeteer] [${requestId}] -> Profile page`);
                        await page.goto(`${this.siteBase}/SATYA/Academics/StudentProfile.aspx`, { waitUntil: 'networkidle2', timeout: 30000 });
                        await this._recordNavigationTimings(page, profileSpan, 'profile');
                        let loaded = await this._waitForContent(page, 'divProfile', 15000, requestId);
                        if (!loaded) {
                            await page.evaluate(() => { if (typeof profileProcess === 'function') profileProcess(); else if (typeof _onShowClick === 'function') _onShowClick(); });
                            await this._waitForContent(page, 'divProfile', 10000, requestId);
                        }
                        await new Promise(r => setTimeout(r, 2000));
                        scrapedData.profileHtml = await page.evaluate(() => { const el = document.getElementById('divProfile'); return el ? el.innerHTML : ''; });
                        logger.info(`[Puppeteer] [${requestId}] Profile: ${scrapedData.profileHtml.length} chars`);
                        this._saveDebug('profile', scrapedData.profileHtml);
                    } catch (e) { logger.error(`[Puppeteer] [${requestId}] Profile error: ${e.message}`); scrapedData.profileHtml = ''; }
                });

                // 3. Marks + Attendance
                await traceSpan('puppeteer.erp.scrapeMarks', {
                    'dependency.type': 'external',
                    'dependency.name': 'sitam_erp',
                    'dependency.category': 'academic_platform',
                    'dependency.criticality': 'high'
                }, async (marksSpan) => {
                    try {
                        logger.info(`[Puppeteer] [${requestId}] -> Marks page`);
                        await page.goto(`${this.siteBase}/SATYA/Academics/StudentMarksReport.aspx`, { waitUntil: 'networkidle2', timeout: 30000 });
                        await this._recordNavigationTimings(page, marksSpan, 'marks');
                        let loaded = await this._waitForContent(page, 'divMarks', 15000, requestId);
                        if (!loaded) {
                            await page.evaluate(() => { if (typeof GetMarksReport === 'function') GetMarksReport(); });
                            await this._waitForContent(page, 'divMarks', 10000, requestId);
                        }
                        await new Promise(r => setTimeout(r, 2000));
                        scrapedData.marksHtml = await page.evaluate(() => { const el = document.getElementById('divMarks'); return el ? el.innerHTML : ''; });
                        logger.info(`[Puppeteer] [${requestId}] Marks: ${scrapedData.marksHtml.length} chars`);
                        this._saveDebug('marks', scrapedData.marksHtml);
                    } catch (e) { logger.error(`[Puppeteer] [${requestId}] Marks error: ${e.message}`); scrapedData.marksHtml = ''; }
                });

                // 4. Fees
                await traceSpan('puppeteer.erp.scrapeFees', {
                    'dependency.type': 'external',
                    'dependency.name': 'sitam_erp',
                    'dependency.category': 'academic_platform',
                    'dependency.criticality': 'high'
                }, async (feesSpan) => {
                    try {
                        logger.info(`[Puppeteer] [${requestId}] -> Fees page`);
                        await page.goto(`${this.siteBase}/SATYA/FeePayments/studentpayments.aspx`, { waitUntil: 'networkidle2', timeout: 30000 });
                        await this._recordNavigationTimings(page, feesSpan, 'fees');
                        let loaded = await this._waitForContent(page, 'divReport', 15000, requestId);
                        if (!loaded) {
                            await page.evaluate(() => { if (typeof _showReport === 'function') _showReport(); });
                            await this._waitForContent(page, 'divReport', 10000, requestId);
                        }
                        await new Promise(r => setTimeout(r, 2000));
                        scrapedData.feesHtml = await page.content();
                        logger.info(`[Puppeteer] [${requestId}] Fees: ${scrapedData.feesHtml.length} chars`);
                        this._saveDebug('fees', scrapedData.feesHtml);
                    } catch (e) { logger.error(`[Puppeteer] [${requestId}] Fees error: ${e.message}`); scrapedData.feesHtml = ''; }
                });

                // 5. Assignments
                await traceSpan('puppeteer.erp.scrapeAssignments', {
                    'dependency.type': 'external',
                    'dependency.name': 'sitam_erp',
                    'dependency.category': 'academic_platform',
                    'dependency.criticality': 'high'
                }, async (assignmentsSpan) => {
                    try {
                        logger.info(`[Puppeteer] [${requestId}] -> Assignments page`);
                        await page.goto(`${this.siteBase}/SATYA/Academics/StudentAssignmentsReport.aspx`, { waitUntil: 'networkidle2', timeout: 30000 });
                        await this._recordNavigationTimings(page, assignmentsSpan, 'assignments');
                        await new Promise(r => setTimeout(r, 3000));
                        scrapedData.assignmentsHtml = await page.content();
                        logger.info(`[Puppeteer] [${requestId}] Assignments: ${scrapedData.assignmentsHtml.length} chars`);
                        this._saveDebug('assignments', scrapedData.assignmentsHtml);
                    } catch (e) { logger.error(`[Puppeteer] [${requestId}] Assignments error: ${e.message}`); scrapedData.assignmentsHtml = ''; }
                });

                const totalMs = Date.now() - startTime;
                logger.info(`[Puppeteer] [${requestId}] SCRAPE COMPLETE in ${totalMs}ms — profile=${(scrapedData.profileHtml || '').length} marks=${(scrapedData.marksHtml || '').length} fees=${(scrapedData.feesHtml || '').length} assignments=${(scrapedData.assignmentsHtml || '').length}`);

                return { cookieString, scrapedData };

            } catch (error) {
                logger.error(`[Puppeteer] [${requestId}] Login/scrape FAILED: ${error.message}`, { stack: error.stack });
                throw error;
            } finally {
                // CRITICAL: Always release the browser back to the pool
                // This destroys the incognito context, wiping all cookies/storage
                if (browserId !== null) {
                    await browserPool.release(browserId, context, requestId);
                }
            }
        });
    }
}

module.exports = new PuppeteerService();
