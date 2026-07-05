/**
 * SITAM Smart ERP — Puppeteer Service (Browser Pool Edition)
 *
 * Replaces one-shot browser launches with the shared BrowserPool.
 * Every student sync job gets:
 *   - A pre-warmed, reusable browser instance (eliminates 3-8s cold start)
 *   - An isolated incognito context (zero cross-student cookie leakage)
 *   - Circuit breaker protection (fast-fail if ERP is down)
 *
 * Performance optimisations applied (v2):
 *   - networkidle2 ONLY for ERP login navigation (reliable auth detection)
 *   - domcontentloaded for ALL post-login page navigations (3-5x faster)
 *   - All 4 data pages scraped in PARALLEL via Promise.all() inside the
 *     same browser context (shared session cookie, 4 separate pages)
 *   - Removed all arbitrary setTimeout(r, 2000/3000) sleep calls
 *   - console.time() / console.timeEnd() on every measurable step
 *   - loginWithCookies() for incremental sync without re-auth
 */

const fs   = require('fs');
const path = require('path');
const browserPool     = require('./browserPool');
const circuitBreaker  = require('./circuitBreaker');
const logger          = require('./logger');
const PerformanceTimer = require('./performanceTimer');
const { traceSpan }   = require('../telemetry/tracing');
const maintDetector   = require('../providers/scraper/maintenance/ERPMaintenanceDetector');
const antiBotDetector = require('../providers/scraper/antibot/AntiBotDetector');
const selectorOptimizer = require('../providers/scraper/selectors/AdaptiveSelectorOptimizer');

class PuppeteerService {
    constructor() {
        this.baseUrl  = process.env.ERP_BASE_URL;
        this.siteBase = this.baseUrl ? this.baseUrl.split('/SATYA')[0] : '';
        this.debugDir = path.join(__dirname, '..');
    }

    async _resolveAndInteract(page, selectorKey, action = 'wait', actionArgs = [], timeout = 10000) {
        const chain = await selectorOptimizer.getOptimizedChain(selectorKey);
        let lastErr = null;
        for (let i = 0; i < chain.length; i++) {
            const selector = chain[i];
            try {
                await page.waitForSelector(selector, { timeout: Math.max(1000, Math.floor(timeout / chain.length)) });
                if (action === 'click') {
                    await page.click(selector);
                } else if (action === 'type') {
                    await page.type(selector, ...actionArgs);
                }
                await selectorOptimizer.recordOutcome(selectorKey, i, true, page.url());
                return selector;
            } catch (err) {
                lastErr = err;
                await selectorOptimizer.recordOutcome(selectorKey, i, false, page.url());
            }
        }
        const { SelectorDriftError } = require('../providers/errors');
        throw new SelectorDriftError(`Failed to resolve selector for key: ${selectorKey}`, {
            providerName: 'sitam-scraper',
            operationName: `resolve:${selectorKey}`,
            selectorAttempts: chain
        });
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
                    dns:     t.domainLookupEnd - t.domainLookupStart,
                    tcp:     t.connectEnd - t.connectStart,
                    request: t.responseEnd - t.requestStart,
                    dom:     t.domContentLoadedEventEnd - t.navigationStart,
                    load:    t.loadEventEnd - t.navigationStart
                };
            });
            span.addEvent(`${stepName}_navigation_timing`, timing);
            span.setAttribute(`${stepName}.dns_resolution_ms`, timing.dns);
            span.setAttribute(`${stepName}.tcp_connection_ms`, timing.tcp);
            span.setAttribute(`${stepName}.dom_content_loaded_ms`, timing.dom);
            span.setAttribute(`${stepName}.page_load_ms`, timing.load);
        } catch (_) {}
    }

    /**
     * Wait for the actual content selector to appear and be non-empty.
     * Used instead of networkidle2 on post-login AJAX-rendered pages.
     */
    async _waitForContent(page, selectorKey, timeout = 15000, requestId = 'unknown') {
        try {
            const selector = await this._resolveAndInteract(page, selectorKey, 'wait', [], timeout);
            await page.waitForFunction(
                (sel) => {
                    const el = document.querySelector(sel);
                    return el && el.innerText.trim().length > 20;
                },
                { timeout },
                selector
            );
            logger.info(`[Puppeteer] [${requestId}] Content loaded in ${selectorKey} (${selector})`);
            return true;
        } catch (e) {
            logger.warn(`[Puppeteer] [${requestId}] Timeout waiting for ${selectorKey}`);
            return false;
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Public API
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Full login + scrape flow. Uses browser pool + circuit breaker.
     */
    async login(userId, password, requestId = 'unknown', recoveryPlan = null) {
        return circuitBreaker.execute(async () => {
            return this._loginWithPool(userId, password, requestId, recoveryPlan);
        }, requestId);
    }

    /**
     * Cookie-based scrape that skips the ERP login form.
     * Called by syncIncremental() when a valid session already exists.
     *
     * @param {string} userId
     * @param {string} cookieString - Raw "name=value; name2=value2" cookie header
     * @param {string} [requestId]
     * @returns {{ scrapedData: object }}
     */
    async loginWithCookies(userId, cookieString, requestId = 'unknown') {
        return circuitBreaker.execute(async () => {
            return this._scrapeWithCookies(userId, cookieString, requestId);
        }, requestId);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Private: Full Login + Parallel Scrape
    // ─────────────────────────────────────────────────────────────────────────

    async _loginWithPool(userId, password, requestId, recoveryPlan = null) {
        const timer = new PerformanceTimer(requestId, userId);
        timer.start('total');

        return traceSpan('puppeteer.erp.sync', {
            'user.id': userId,
            'dependency.type': 'external',
            'dependency.name': 'sitam_erp',
            'dependency.category': 'academic_platform',
            'dependency.criticality': 'high'
        }, async (parentSpan) => {
            let browserId  = null;
            let context    = null;
            let scrapeError = null;

            try {
                // ── Maintenance check (no browser needed) ──────────────────
                if (await maintDetector.isInMaintenanceWindow()) {
                    const { ERPUnavailableError } = require('../providers/errors');
                    throw new ERPUnavailableError('ERP is undergoing scheduled maintenance.', {
                        providerName: 'sitam-scraper',
                        operationName: 'login'
                    });
                }

                // ── Acquire browser ────────────────────────────────────────
                timer.start('browserAcquire');
                logger.info(`[Puppeteer] [${requestId}] Acquiring browser from pool for: ${userId}`);
                ({ browserId, context } = await browserPool.acquire(requestId));
                timer.end('browserAcquire');

                parentSpan.setAttribute('browser.acquire_delay_ms', timer.get('browserAcquire'));
                parentSpan.addEvent('browser_acquire_success', { browserId });
                logger.info(`[Puppeteer] [${requestId}] Pool acquired browser ${browserId} in ${timer.get('browserAcquire')}ms`);

                // ── Open auth page ─────────────────────────────────────────
                const authPage = await context.newPage();
                await authPage.setViewport({ width: 1280, height: 800 });
                await authPage.setUserAgent(
                    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                );

                // ── LOGIN (networkidle2 — required for reliable auth) ──────
                timer.start('erpAuth');
                await traceSpan('puppeteer.erp.login', {
                    'dependency.type': 'external',
                    'dependency.name': 'sitam_erp',
                    'dependency.category': 'academic_platform',
                    'dependency.criticality': 'high'
                }, async (loginSpan) => {
                    loginSpan.addEvent('erp_login_started');
                    const loginUrl = `${this.siteBase}/SATYA/Default.aspx`;
                    logger.info(`[Puppeteer] [${requestId}] Navigating to login: ${loginUrl}`);

                    // ── networkidle2 ONLY for login page ──────────────────
                    try {
                        await authPage.goto(loginUrl, { waitUntil: 'networkidle2', timeout: 60000 });
                    } catch (loginGotoErr) {
                        logger.warn(`[Puppeteer] [${requestId}] Login navigation failed: ${loginGotoErr.message}. Retrying once with 60s timeout...`);
                        await authPage.goto(loginUrl, { waitUntil: 'networkidle2', timeout: 60000 });
                    }

                    // Maintenance + anti-bot checks
                    const maintResult = await maintDetector.detect(authPage);
                    if (maintResult.detected) {
                        const { ERPUnavailableError } = require('../providers/errors');
                        throw new ERPUnavailableError(`ERP under maintenance: ${maintResult.message}`, {
                            providerName: 'sitam-scraper',
                            operationName: 'login'
                        });
                    }
                    await antiBotDetector.assertNoBotChallenge(authPage, { pageName: 'login', requestId });

                    // Fill credentials
                    const usernameSel = await this._resolveAndInteract(authPage, 'LOGIN_USERNAME', 'click');
                    await authPage.type(usernameSel, userId, { delay: 30 });

                    const passwordSel = await this._resolveAndInteract(authPage, 'LOGIN_PASSWORD', 'click');
                    await authPage.type(passwordSel, password, { delay: 30 });

                    await authPage.evaluate((sel) => {
                        const el = document.querySelector(sel);
                        if (el) el.blur();
                    }, passwordSel);

                    // Small blur-settle delay (200ms instead of 500ms)
                    await new Promise(r => setTimeout(r, 200));

                    logger.info(`[Puppeteer] [${requestId}] Submitting login...`);
                    const loginBtnSelector = await this._resolveAndInteract(authPage, 'LOGIN_BUTTON', 'wait');

                    // ── networkidle2 for post-submit navigation ────────────
                    await Promise.all([
                        authPage.click(loginBtnSelector),
                        authPage.waitForNavigation({ waitUntil: 'networkidle2', timeout: 40000 })
                    ]).catch(e => logger.info(`[Puppeteer] [${requestId}] Nav note: ${e.message}`));

                    await this._recordNavigationTimings(authPage, loginSpan, 'login');

                    const pageUrl = authPage.url();
                    logger.info(`[Puppeteer] [${requestId}] Post-login URL: ${pageUrl}`);

                    await antiBotDetector.assertNoBotChallenge(authPage, { pageName: 'login_post', requestId });

                    if (pageUrl.includes('Default.aspx')) {
                        throw new Error('Login failed — still on login page. Check credentials.');
                    }
                    loginSpan.addEvent('erp_login_success');
                });
                timer.end('erpAuth');

                // ── Extract cookies from auth page ─────────────────────────
                const browserCookies = await authPage.cookies();
                const cookieString   = browserCookies.map(c => `${c.name}=${c.value}`).join('; ');
                logger.info(`[Puppeteer] [${requestId}] Cookies (${browserCookies.length}): ${browserCookies.map(c => c.name).join(', ')}`);

                if (!cookieString.includes('ASP.NET_SessionId')) {
                    logger.warn(`[Puppeteer] [${requestId}] WARNING: No ASP.NET_SessionId in cookies!`);
                }

                // ── Student name (fast, on the already-loaded page) ────────
                const scrapedData = {};
                try {
                    const selector = await this._resolveAndInteract(authPage, 'LOGGED_IN_INDICATOR', 'wait', [], 5000);
                    const nameText = await authPage.evaluate((sel) => {
                        const el = document.querySelector(sel);
                        return el ? el.textContent : '';
                    }, selector);
                    scrapedData.studentName = nameText.replace(/^Hi[.\s]*/i, '').trim();
                    logger.info(`[Puppeteer] [${requestId}] Name: "${scrapedData.studentName}"`);
                } catch (e) { scrapedData.studentName = userId; }

                // ── Parallel scraping: 4 pages, same context ──────────────
                timer.start('parallelScrape');
                logger.info(`[Puppeteer] [${requestId}] Starting parallel 4-page scrape...`);

                const shouldScrape = (module) => !recoveryPlan || recoveryPlan.includes(module);

                const [profileResult, marksResult, feesResult, assignmentsResult] = await Promise.all([
                    shouldScrape('profile')     ? this._scrapePage(context, 'profile',      requestId, timer) : Promise.resolve({ html: '', key: 'profileHtml' }),
                    shouldScrape('marks')       ? this._scrapePage(context, 'marks',        requestId, timer) : Promise.resolve({ html: '', key: 'marksHtml' }),
                    shouldScrape('fees')        ? this._scrapePage(context, 'fees',         requestId, timer) : Promise.resolve({ html: '', key: 'feesHtml' }),
                    shouldScrape('assignments') ? this._scrapePage(context, 'assignments',  requestId, timer) : Promise.resolve({ html: '', key: 'assignmentsHtml' })
                ]);

                scrapedData.profileHtml     = profileResult.html;
                scrapedData.marksHtml       = marksResult.html;
                scrapedData.feesHtml        = feesResult.html;
                scrapedData.assignmentsHtml = assignmentsResult.html;

                timer.end('parallelScrape');

                // ── Close auth page (context remains alive for pool reuse) ──
                try { await authPage.close(); } catch (_) {}

                const report = timer.report({
                    loginType: 'full',
                    cookieCount: browserCookies.length,
                    profileLen: scrapedData.profileHtml?.length || 0,
                    marksLen:   scrapedData.marksHtml?.length   || 0,
                    feesLen:    scrapedData.feesHtml?.length     || 0,
                    assignmentsLen: scrapedData.assignmentsHtml?.length || 0
                });

                logger.info(
                    `[Puppeteer] [${requestId}] SCRAPE COMPLETE in ${report.totalMs}ms — ` +
                    `auth=${timer.get('erpAuth')}ms parallel=${timer.get('parallelScrape')}ms`
                );

                return { cookieString, scrapedData, perfReport: report };

            } catch (error) {
                scrapeError = error;
                // Check if failure page is a maintenance page
                logger.error(`[Puppeteer] [${requestId}] Login/scrape FAILED: ${error.message}`, { stack: error.stack });
                throw error;
            } finally {
                timer.end('total');
                if (browserId !== null) {
                    await browserPool.release(browserId, context, requestId, scrapeError);
                }
            }
        });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Private: Scrape a single ERP data page (domcontentloaded + selector wait)
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Opens a new page in the provided context and scrapes the given module.
     * Uses domcontentloaded (fast) then waits for the actual data selector.
     *
     * @param {BrowserContext} context
     * @param {'profile'|'marks'|'fees'|'assignments'} module
     * @param {string} requestId
     * @param {PerformanceTimer} timer
     * @returns {{ html: string, key: string }}
     */
    async _scrapePage(context, module, requestId, timer) {
        const config = {
            profile: {
                url:          `${this.siteBase}/SATYA/Academics/StudentProfile.aspx`,
                selectorKey:  'PROFILE_CONTAINER',
                triggerFn:    'typeof profileProcess === "function" ? profileProcess() : (typeof _onShowClick === "function" ? _onShowClick() : null)',
                htmlExtract:  'selector', // extract innerHTML of selector
                pageName:     'profile',
                key:          'profileHtml'
            },
            marks: {
                url:          `${this.siteBase}/SATYA/Academics/StudentMarksReport.aspx`,
                selectorKey:  'MARKS_CONTAINER',
                triggerFn:    'typeof GetMarksReport === "function" ? GetMarksReport() : null',
                htmlExtract:  'selector',
                pageName:     'marks',
                key:          'marksHtml'
            },
            fees: {
                url:          `${this.siteBase}/SATYA/FeePayments/studentpayments.aspx`,
                selectorKey:  'FEES_CONTAINER',
                triggerFn:    'typeof _showReport === "function" ? _showReport() : null',
                htmlExtract:  'fullPage', // use full page content
                pageName:     'fees',
                key:          'feesHtml'
            },
            assignments: {
                url:          `${this.siteBase}/SATYA/Academics/StudentAssignmentsReport.aspx`,
                selectorKey:  'ASSIGNMENTS_CONTAINER',
                triggerFn:    null,
                htmlExtract:  'fullPage',
                pageName:     'assignments',
                key:          'assignmentsHtml'
            }
        };

        const cfg = config[module];
        if (!cfg) return { html: '', key: `${module}Html` };

        const stepLabel = `scrape:${module}`;
        timer.start(stepLabel);

        let page = null;
        try {
            page = await context.newPage();

            return await traceSpan(`puppeteer.erp.scrape${module.charAt(0).toUpperCase() + module.slice(1)}`, {
                'dependency.type': 'external',
                'dependency.name': 'sitam_erp',
                'dependency.category': 'academic_platform',
                'dependency.criticality': 'high'
            }, async (span) => {
                logger.info(`[Puppeteer] [${requestId}] [${module}] Navigating to ${cfg.url}`);

                try {
                    await page.goto(cfg.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
                } catch (gotoErr) {
                    logger.warn(`[Puppeteer] [${requestId}] [${module}] Navigation failed: ${gotoErr.message}. Retrying with 60s timeout...`);
                    await page.goto(cfg.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
                }

                await antiBotDetector.assertNoBotChallenge(page, { pageName: cfg.pageName, requestId });
                await this._recordNavigationTimings(page, span, module);

                // ── Wait for actual data selector (AJAX-aware) ─────────────
                let loaded = await this._waitForContent(page, cfg.selectorKey, 15000, requestId);

                // If selector not yet populated, trigger the page's JS render function
                if (!loaded && cfg.triggerFn) {
                    logger.info(`[Puppeteer] [${requestId}] [${module}] Triggering JS render function`);
                    await page.evaluate((fnCode) => {
                        try { eval(fnCode); } catch (_) {}
                    }, cfg.triggerFn);
                    loaded = await this._waitForContent(page, cfg.selectorKey, 10000, requestId);
                }

                // ── Extract HTML ───────────────────────────────────────────
                let html = '';
                if (cfg.htmlExtract === 'fullPage') {
                    html = await page.content();
                } else {
                    const sel = await this._resolveAndInteract(page, cfg.selectorKey, 'wait');
                    html = await page.evaluate((s) => {
                        const el = document.querySelector(s);
                        return el ? el.innerHTML : '';
                    }, sel);
                }

                logger.info(`[Puppeteer] [${requestId}] [${module}] Scraped ${html.length} chars`);
                this._saveDebug(module, html);

                span.addEvent(`${module}_scraped`, { htmlLength: html.length });
                return { html, key: cfg.key };
            });

        } catch (e) {
            logger.error(`[Puppeteer] [${requestId}] [${module}] Error: ${e.message}`);
            return { html: '', key: cfg.key };
        } finally {
            timer.end(stepLabel);
            try { if (page) await page.close(); } catch (_) {}
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Private: Cookie-based scrape (no login form — incremental sync)
    // ─────────────────────────────────────────────────────────────────────────

    async _scrapeWithCookies(userId, cookieString, requestId) {
        const timer = new PerformanceTimer(requestId, userId);
        timer.start('total');
        timer.start('browserAcquire');

        logger.info(`[Puppeteer] [${requestId}] Cookie-based incremental scrape for: ${userId}`);

        let browserId  = null;
        let context    = null;
        let scrapeError = null;

        try {
            ({ browserId, context } = await browserPool.acquire(requestId));
            timer.end('browserAcquire');

            // Inject cookies into the context via a temporary page
            const cookiePage = await context.newPage();
            try {
                // Navigate to a base URL so we can set domain cookies
                try {
                    await cookiePage.goto(`${this.siteBase}/SATYA/Default.aspx`, {
                        waitUntil: 'domcontentloaded',
                        timeout: 30000
                    });
                } catch (cookieGotoErr) {
                    logger.warn(`[Puppeteer] [${requestId}] Cookie page navigation failed: ${cookieGotoErr.message}. Retrying once with 30s timeout...`);
                    await cookiePage.goto(`${this.siteBase}/SATYA/Default.aspx`, {
                        waitUntil: 'domcontentloaded',
                        timeout: 30000
                    });
                }

                // Parse and set cookies from cookie string
                const cookiePairs = cookieString.split(';').map(s => s.trim());
                const domain = new URL(`${this.siteBase}`).hostname;
                const cookieObjects = cookiePairs
                    .filter(p => p.includes('='))
                    .map(p => {
                        const [name, ...rest] = p.split('=');
                        return { name: name.trim(), value: rest.join('=').trim(), domain, path: '/' };
                    });

                await context.setCookie(...cookieObjects);
                logger.info(`[Puppeteer] [${requestId}] Injected ${cookieObjects.length} cookies into context`);

                // Check if the session is valid (not redirected to login page)
                const currentUrl = cookiePage.url();
                if (currentUrl.includes('Default.aspx') && cookiePairs.length < 2) {
                    throw new Error('Session expired — login page detected after cookie injection');
                }
            } finally {
                try { await cookiePage.close(); } catch (_) {}
            }

            // Now scrape all pages in parallel with injected cookies
            timer.start('parallelScrape');
            const [profileResult, marksResult, feesResult, assignmentsResult] = await Promise.all([
                this._scrapePage(context, 'profile',     requestId, timer),
                this._scrapePage(context, 'marks',       requestId, timer),
                this._scrapePage(context, 'fees',        requestId, timer),
                this._scrapePage(context, 'assignments', requestId, timer)
            ]);
            timer.end('parallelScrape');

            const scrapedData = {
                studentName:     userId,
                profileHtml:     profileResult.html,
                marksHtml:       marksResult.html,
                feesHtml:        feesResult.html,
                assignmentsHtml: assignmentsResult.html
            };

            const report = timer.report({ loginType: 'cookie-incremental' });
            logger.info(`[Puppeteer] [${requestId}] Cookie-scrape COMPLETE in ${report.totalMs}ms`);

            return { scrapedData, perfReport: report };

        } catch (error) {
            scrapeError = error;
            logger.error(`[Puppeteer] [${requestId}] Cookie-based scrape FAILED: ${error.message}`);
            throw error;
        } finally {
            timer.end('total');
            if (browserId !== null) {
                await browserPool.release(browserId, context, requestId, scrapeError);
            }
        }
    }
}

module.exports = new PuppeteerService();
