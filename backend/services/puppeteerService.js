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
const classifier      = require('../providers/scraper/retry/AdaptiveRetryClassifier');

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
            let attempts = 0;
            const maxAttempts = 2;

            while (attempts < maxAttempts) {
                attempts++;
                let releaseError = null;
                try {
                    // ── Maintenance check (no browser needed) ──────────────────
                    if (await maintDetector.isInMaintenanceWindow()) {
                        const { ERPUnavailableError } = require('../providers/errors');
                        throw new ERPUnavailableError('ERP is undergoing scheduled maintenance.', {
                            providerName: 'sitam-scraper',
                            operationName: 'login'
                        });
                    }

                    // ── BUG 1 FIX: Use AUTH_POOL for login jobs, not SYNC_POOL ──
                    // browserPool.acquire() routes to SYNC_POOL at BACKGROUND_SYNC
                    // priority. Login must use AUTH_POOL (dedicated, high-priority).
                    // Using SYNC_POOL means a login request waits behind 4 background
                    // scrapes — causing 60s timeouts and "Target closed" errors.
                    timer.start('browserAcquire');
                    logger.info(
                        `[Puppeteer] [${requestId}] Acquiring browser from AUTH_POOL for: ${userId} ` +
                        `(attempt ${attempts}/${maxAttempts})`
                    );
                    const { JOB_PRIORITY } = require('./browserPool/PriorityQueue');
                    ({ browserId, context } = await browserPool.authPool.acquire({
                        priority:  JOB_PRIORITY.LOGIN,
                        requestId,
                        jobType:   'LOGIN',
                        userId,
                    }));
                    timer.end('browserAcquire');

                    parentSpan.setAttribute('browser.acquire_delay_ms', timer.get('browserAcquire'));
                    parentSpan.addEvent('browser_acquire_success', { browserId });
                    logger.info(
                        `[Puppeteer] [${requestId}] AUTH_POOL acquired browser ${browserId} ` +
                        `in ${timer.get('browserAcquire')}ms`
                    );

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
                    let scrapedName = userId;
                    try {
                        const selector = await this._resolveAndInteract(authPage, 'LOGGED_IN_INDICATOR', 'wait', [], 5000);
                        const nameText = await authPage.evaluate((sel) => {
                            const el = document.querySelector(sel);
                            return el ? el.textContent : '';
                        }, selector);
                        scrapedName = nameText.replace(/^Hi[.\s]*/i, '').trim();
                        logger.info(`[Puppeteer] [${requestId}] Name: "${scrapedName}"`);
                    } catch (e) { scrapedName = userId; }

                    // ── Parallel scraping: 4 pages, same context ──────────────
                    timer.start('parallelScrape');
                    logger.info(`[Puppeteer] [${requestId}] Starting parallel/concurrency scrape...`);

                    const shouldScrape = (module) => !recoveryPlan || recoveryPlan.includes(module);

                    const scrapeResults = await this._scrapeAllModules(context, shouldScrape, requestId, timer);

                    scrapedData.studentName     = scrapedName;
                    scrapedData.profileHtml     = scrapeResults.profileHtml;
                    scrapedData.marksHtml       = scrapeResults.marksHtml;
                    scrapedData.feesHtml        = scrapeResults.feesHtml;
                    scrapedData.assignmentsHtml = scrapeResults.assignmentsHtml;

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

                    // BUG 2 FIX: Release is now ONLY in the finally block.
                    // Previously, releasing here on success AND then the catch block
                    // could also release if the try-release itself threw — causing a
                    // double-release that corrupts browser state and triggers
                    // "Protocol error (Target.createTarget): Target closed" on the
                    // next acquire. The finally block below guarantees exactly-once
                    // release regardless of success, failure, or error-in-release.
                    return { cookieString, scrapedData, perfReport: report };

                } catch (error) {
                    releaseError = error;
                    logger.error(
                        `[Puppeteer] [${requestId}] Login/scrape FAILED ` +
                        `(attempt ${attempts}/${maxAttempts}): ${error.message}`,
                        { stack: error.stack }
                    );

                    const strategy = classifier.classify(error, { attempt: attempts });
                    if (!strategy.retry || attempts >= maxAttempts) {
                        throw error;
                    }

                    logger.warn(`[Puppeteer] [${requestId}] Retrying login/scrape with a fresh browser...`);
                } finally {
                    // BUG 2 FIX: Exactly-once release, always in finally.
                    // browserId is non-null only when acquire() succeeded and we
                    // haven't released yet. We null it immediately after to prevent
                    // any second release path.
                    if (browserId !== null) {
                        const ctxToRelease = context;
                        const bidToRelease = browserId;
                        browserId = null;
                        context   = null;
                        try {
                            await browserPool.authPool.release(
                                bidToRelease, ctxToRelease, requestId, releaseError
                            );
                        } catch (releaseErr) {
                            logger.warn(
                                `[Puppeteer] [${requestId}] Browser release warning (non-fatal): ` +
                                `${releaseErr.message}`
                            );
                        }
                    }
                }
            }
        });
    }

    async _scrapeAllModules(context, shouldScrape, requestId, timer) {
        const isProduction = process.env.NODE_ENV === 'production' || process.env.RENDER === 'true';
        const limit = isProduction ? 2 : 4;

        const tasks = [
            { name: 'profile', key: 'profileHtml' },
            { name: 'fees', key: 'feesHtml' },
            { name: 'marks', key: 'marksHtml' },
            { name: 'assignments', key: 'assignmentsHtml' }
        ].filter(t => shouldScrape(t.name));

        const results = {
            profileHtml: '',
            marksHtml: '',
            feesHtml: '',
            assignmentsHtml: ''
        };

        const os = require('os');

        logger.info(`[Puppeteer] [${requestId}] Starting scraping batch: modules=[${tasks.map(t=>t.name).join(', ')}], concurrencyLimit=${limit}`);

        for (let i = 0; i < tasks.length; i += limit) {
            const chunk = tasks.slice(i, i + limit);
            
            // Log memory usage before chunk execution
            const memBefore = process.memoryUsage();
            const sysFreeBefore = Math.round(os.freemem() / 1024 / 1024);
            logger.info(`[Puppeteer] [${requestId}] Scraping chunk starting: [${chunk.map(t=>t.name).join(', ')}] | Node RSS: ${Math.round(memBefore.rss/1024/1024)}MB | SysFree: ${sysFreeBefore}MB`);

            const startTime = Date.now();
            await Promise.all(chunk.map(async (task) => {
                const res = await this._scrapePage(context, task.name, requestId, timer);
                results[task.key] = res.html;
            }));

            const duration = Date.now() - startTime;
            // Log memory usage after chunk execution
            const memAfter = process.memoryUsage();
            const sysFreeAfter = Math.round(os.freemem() / 1024 / 1024);
            logger.info(`[Puppeteer] [${requestId}] Scraping chunk completed in ${duration}ms: [${chunk.map(t=>t.name).join(', ')}] | Node RSS: ${Math.round(memAfter.rss/1024/1024)}MB | SysFree: ${sysFreeAfter}MB`);
        }

        // Trigger garbage collection if available
        if (global.gc) {
            try {
                logger.info(`[Puppeteer] [${requestId}] Triggering manual garbage collection...`);
                global.gc();
                const memPostGc = process.memoryUsage();
                logger.info(`[Puppeteer] [${requestId}] GC complete. Node RSS: ${Math.round(memPostGc.rss/1024/1024)}MB`);
            } catch (_) {}
        }

        return results;
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

        const os = require('os');
        const startMem = process.memoryUsage();
        const startSysFree = Math.round(os.freemem() / 1024 / 1024);
        const startTime = Date.now();
        logger.info(`[Puppeteer] [${requestId}] [${module}] Start scrape task | Node RSS: ${Math.round(startMem.rss/1024/1024)}MB | SysFree: ${startSysFree}MB`);

        const SCRAPE_TIMEOUT = 45000;
        let page = null;
        let timeoutId = null;

        try {
            const timeoutPromise = new Promise((_, reject) => {
                timeoutId = setTimeout(() => {
                    reject(new Error(`Scrape timeout after ${SCRAPE_TIMEOUT}ms for module ${module}`));
                }, SCRAPE_TIMEOUT);
            });

            const scrapePromise = (async () => {
                page = await context.newPage();

                return await traceSpan(`puppeteer.erp.scrape${module.charAt(0).toUpperCase() + module.slice(1)}`, {
                    'dependency.type': 'external',
                    'dependency.name': 'sitam_erp',
                    'dependency.category': 'academic_platform',
                    'dependency.criticality': 'high'
                }, async (span) => {
                    logger.info(`[Puppeteer] [${requestId}] [${module}] Navigating to ${cfg.url}`);

                    try {
                        await page.goto(cfg.url, { waitUntil: 'domcontentloaded', timeout: 40000 });
                    } catch (gotoErr) {
                        logger.warn(`[Puppeteer] [${requestId}] [${module}] Navigation failed: ${gotoErr.message}. Retrying with 40000ms timeout...`);
                        await page.goto(cfg.url, { waitUntil: 'domcontentloaded', timeout: 40000 });
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
            })();

            const res = await Promise.race([scrapePromise, timeoutPromise]);
            return res;

        } catch (e) {
            logger.error(`[Puppeteer] [${requestId}] [${module}] Error: ${e.message}`);
            const isTimeoutOrDisconnect = e.message.toLowerCase().includes('timeout') || e.message.toLowerCase().includes('target closed') || e.message.toLowerCase().includes('disconnected');
            if (isTimeoutOrDisconnect) {
                throw e; // Propagate for retry
            }
            return { html: '', key: cfg.key };
        } finally {
            if (timeoutId) clearTimeout(timeoutId);
            timer.end(stepLabel);
            const duration = Date.now() - startTime;
            const endMem = process.memoryUsage();
            const endSysFree = Math.round(os.freemem() / 1024 / 1024);
            
            let openPagesCount = 'unknown';
            try {
                const browser = typeof context.browser === 'function' ? context.browser() : null;
                if (browser && typeof browser.pages === 'function') {
                    openPagesCount = browser._targets ? Object.keys(browser._targets).length : 'unknown';
                }
            } catch (_) {}
            
            logger.info(`[Puppeteer] [${requestId}] [${module}] End scrape task | Duration: ${duration}ms | Node RSS: ${Math.round(endMem.rss/1024/1024)}MB | SysFree: ${endSysFree}MB | OpenPages: ${openPagesCount}`);
            
            try { if (page) await page.close(); } catch (_) {}
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Private: Cookie-based scrape (no login form — incremental sync)
    // ─────────────────────────────────────────────────────────────────────────

    async _scrapeWithCookies(userId, cookieString, requestId) {
        const timer = new PerformanceTimer(requestId, userId);
        timer.start('total');

        logger.info(`[Puppeteer] [${requestId}] Cookie-based incremental scrape for: ${userId}`);

        let browserId  = null;
        let context    = null;
        let attempts = 0;
        const maxAttempts = 2;

        try {
            while (attempts < maxAttempts) {
                attempts++;
                let releaseError = null;
                try {
                    // ── Acquire browser (SYNC_POOL — incremental, not a login) ─
                    timer.start('browserAcquire');
                    logger.info(
                        `[Puppeteer] [${requestId}] [CookieScrape] Acquiring browser ` +
                        `from SYNC_POOL (attempt ${attempts}/${maxAttempts})`
                    );
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
                            logger.warn(
                                `[Puppeteer] [${requestId}] Cookie page navigation failed: ` +
                                `${cookieGotoErr.message}. Retrying once...`
                            );
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
                        logger.info(
                            `[Puppeteer] [${requestId}] Injected ${cookieObjects.length} cookies into context`
                        );

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
                    const scrapeResults = await this._scrapeAllModules(context, () => true, requestId, timer);
                    timer.end('parallelScrape');

                    const scrapedData = {
                        studentName:     userId,
                        profileHtml:     scrapeResults.profileHtml,
                        marksHtml:       scrapeResults.marksHtml,
                        feesHtml:        scrapeResults.feesHtml,
                        assignmentsHtml: scrapeResults.assignmentsHtml
                    };

                    const report = timer.report({ loginType: 'cookie-incremental' });
                    logger.info(`[Puppeteer] [${requestId}] Cookie-scrape COMPLETE in ${report.totalMs}ms`);

                    // BUG 3 FIX: return here; finally block releases the browser.
                    return { scrapedData, perfReport: report };

                } catch (error) {
                    releaseError = error;
                    logger.error(
                        `[Puppeteer] [${requestId}] Cookie-based scrape FAILED ` +
                        `(attempt ${attempts}/${maxAttempts}): ${error.message}`
                    );

                    const strategy = classifier.classify(error, { attempt: attempts });
                    if (!strategy.retry || attempts >= maxAttempts) {
                        throw error;
                    }

                    logger.warn(`[Puppeteer] [${requestId}] Retrying cookie-based scrape with a fresh browser...`);
                } finally {
                    // BUG 2 FIX (cookie path): Exactly-once release, always in finally.
                    if (browserId !== null) {
                        const ctxToRelease = context;
                        const bidToRelease = browserId;
                        browserId = null;
                        context   = null;
                        try {
                            await browserPool.release(bidToRelease, ctxToRelease, requestId, releaseError);
                        } catch (releaseErr) {
                            logger.warn(
                                `[Puppeteer] [${requestId}] Cookie-scrape release warning: ` +
                                `${releaseErr.message}`
                            );
                        }
                    }
                }
            }
        } finally {
            // BUG 3 FIX: timer.end('total') MUST be outside the retry loop.
            // Previously it was in a per-iteration finally block — ending the timer
            // on every attempt, including retries, causing corrupted timing data
            // and premature cleanup signals.
            timer.end('total');
        }
    }
}

module.exports = new PuppeteerService();
