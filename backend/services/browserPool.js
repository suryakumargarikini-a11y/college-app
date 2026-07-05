/**
 * SITAM Smart ERP — Puppeteer Browser Pool Manager
 *
 * Manages a pool of reusable Chromium browser instances.
 * Each sync job acquires an isolated incognito browser context,
 * performs scraping, then releases it — no cross-student contamination.
 *
 * Architecture:
 *   BrowserPool
 *   └── Browser Instance (x MAX_BROWSERS)
 *       └── Incognito BrowserContext (per job, destroyed after use)
 *           └── Page (navigation, scraping)
 */

const puppeteer = require('puppeteer');
const logger = require('./logger');
const { traceSpan } = require('../telemetry/tracing');
const repMgr = require('../providers/scraper/browser/BrowserReputationManager');
const classifier = require('../providers/scraper/retry/AdaptiveRetryClassifier');
const PerformanceTimer = require('./performanceTimer');

function findChromiumExecutable() {
    const fs = require('fs');
    
    // 1. Check environment variables, but verify existence on disk
    const envPaths = [
        process.env.PUPPETEER_EXECUTABLE_PATH,
        process.env.CHROME_BIN,
        process.env.CHROMIUM_PATH
    ].filter(Boolean);

    for (const envPath of envPaths) {
        if (fs.existsSync(envPath)) {
            logger.info(`[Puppeteer] Environment path verified: ${envPath}`);
            return envPath;
        } else {
            logger.warn(`[Puppeteer] Environment path ignored (not found on disk): ${envPath}`);
        }
    }

    // 2. On Windows, return undefined to auto-resolve from cache
    if (process.platform === 'win32') {
        return undefined;
    }

    // 3. Try Unix shell command discovery (which)
    const { execSync } = require('child_process');
    try {
        const path = execSync('which chromium 2>/dev/null', { stdio: 'pipe' }).toString().trim();
        if (path && fs.existsSync(path)) {
            logger.info(`[Puppeteer] Discovered Chromium via 'which chromium': ${path}`);
            return path;
        }
    } catch (_) {}

    try {
        const path = execSync('which chromium-browser 2>/dev/null', { stdio: 'pipe' }).toString().trim();
        if (path && fs.existsSync(path)) {
            logger.info(`[Puppeteer] Discovered Chromium via 'which chromium-browser': ${path}`);
            return path;
        }
    } catch (_) {}

    try {
        const path = execSync('which google-chrome 2>/dev/null', { stdio: 'pipe' }).toString().trim();
        if (path && fs.existsSync(path)) {
            logger.info(`[Puppeteer] Discovered Chrome via 'which google-chrome': ${path}`);
            return path;
        }
    } catch (_) {}

    // 4. Default check fallbacks
    const fallbacks = [
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
        '/usr/bin/google-chrome',
        '/usr/bin/google-chrome-stable'
    ];
    for (const fallback of fallbacks) {
        if (fs.existsSync(fallback)) {
            logger.info(`[Puppeteer] Discovered Chromium via fallback: ${fallback}`);
            return fallback;
        }
    }

    logger.error('[Puppeteer] No Chromium executable found dynamically.');
    return null;
}

const isProduction = process.env.NODE_ENV === 'production' || process.env.RENDER === 'true';
const MAX_BROWSERS = isProduction ? 1 : parseInt(process.env.BROWSER_POOL_SIZE || '1', 10);
const BROWSER_ACQUIRE_TIMEOUT_MS = parseInt(process.env.BROWSER_ACQUIRE_TIMEOUT_MS || '60000', 10); // Increase acquire timeout to 60s
const BROWSER_IDLE_RECYCLE_MS = parseInt(process.env.BROWSER_IDLE_RECYCLE_MS || '300000', 10); // 5 min

class BrowserPool {
    constructor() {
        this.pool = []; // Array of { id, browser, lastUsed, inUse, createdAt }
        this.waitQueue = []; // Queued resolve functions waiting for a free slot
        this.recycleInterval = null;
        this.isShuttingDown = false;
        this.maxBrowsers = MAX_BROWSERS; // Cap pool to MAX_BROWSERS directly
        this.launchArgs = [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--disable-background-timer-throttling',
            '--disable-backgrounding-occluded-windows',
            '--disable-renderer-backgrounding',
            '--memory-pressure-off',
            '--no-zygote',            // Disable zygote process
            '--disable-extensions',    // Disable browser extensions
            '--no-first-run',         // Prevent first run welcome page
            '--disable-background-networking', // Disable background network activity
            '--disable-features=SitePerProcess', // Avoid spawning nested renderer processes
            '--disable-software-rasterizer'
        ];
        if (process.env.PUPPETEER_SINGLE_PROCESS === 'true') {
            this.launchArgs.push('--single-process');
        }
    }

    /**
     * Initialize the browser pool — pre-warms one browser to cut cold-start latency.
     */
    async init() {
        logger.info(`[BrowserPool] Initializing pool (MAX_BROWSERS=${MAX_BROWSERS})...`);
        console.time('[BrowserPool] init:prewarm');
        try {
            // Pre-warm 2 browser instances to cut cold-start latency for concurrent first-logins.
            // Both browsers are launched in parallel so startup cost is ~1 browser launch, not 2.
            const warmCount = Math.min(2, MAX_BROWSERS);
            logger.info(`[BrowserPool] Pre-warming ${warmCount} browser(s) in parallel...`);
            await Promise.all(
                Array.from({ length: warmCount }, () => this._launchBrowser())
            );
            console.timeEnd('[BrowserPool] init:prewarm');
            logger.info(`[BrowserPool] Pre-warm complete. ${this.pool.length} browser(s) ready.`);
        } catch (err) {
            console.timeEnd('[BrowserPool] init:prewarm');
            logger.error(`[BrowserPool] Pre-warm failed: ${err.message}. Pool will launch on first acquire.`);
        }

        // Periodic idle-browser recycling (every 2 minutes check)
        this.recycleInterval = setInterval(() => this._recycleIdleBrowsers(), 2 * 60 * 1000);
    }

    /**
     * Acquire a free browser slot. Returns { browserId, context } for the caller.
     * The caller MUST call release(browserId, context) when done.
     * Throws if timeout is exceeded and no browser becomes available.
     */
    async acquire(requestId = 'unknown') {
        if (this.isShuttingDown) {
            throw new Error('[BrowserPool] Pool is shutting down. Cannot acquire browser.');
        }

        const acquireStart = Date.now();
        logger.info(`[BrowserPool] [${requestId}] Acquiring browser context...`);
        console.time(`[BrowserPool] acquire:${requestId}`);

        return traceSpan('puppeteer.pool.acquire', {
            'maxBrowsers': MAX_BROWSERS,
            'dependency.type': 'external',
            'dependency.name': 'chromium',
            'dependency.category': 'browser_automation',
            'dependency.criticality': 'high'
        }, async (span) => {
            // Adaptive sizing based on queue depth
            this.adjustPoolSize();

            // Find a non-busy browser
            const freeBrowser = this.pool.find(b => !b.inUse);
            if (freeBrowser) {
                logger.info(`[BrowserPool] [${requestId}] WARM browser available (${freeBrowser.id}) — no launch needed.`);
                const result = await this._checkoutContext(freeBrowser, requestId);
                console.timeEnd(`[BrowserPool] acquire:${requestId}`);
                logger.info(`[BrowserPool] [${requestId}] Warm acquire complete in ${Date.now() - acquireStart}ms`);
                return result;
            }

            // Pool not yet at capacity — launch a new browser
            if (this.pool.length < this.maxBrowsers) {
                logger.info(`[BrowserPool] [${requestId}] COLD start — launching new browser (pool: ${this.pool.length}/${this.maxBrowsers})`);
                const entry = await this._launchBrowser();
                const result = await this._checkoutContext(entry, requestId);
                console.timeEnd(`[BrowserPool] acquire:${requestId}`);
                logger.info(`[BrowserPool] [${requestId}] Cold acquire complete in ${Date.now() - acquireStart}ms`);
                return result;
            }

            // All browsers busy — queue the request with a timeout
            logger.warn(`[BrowserPool] All ${this.maxBrowsers} browsers busy. Queuing request [${requestId}]...`);
            span.setAttribute('pool.exhausted', true);
            span.addEvent('browser_pool_exhausted', { maxBrowsers: MAX_BROWSERS });

            return new Promise((resolve, reject) => {
                const timer = setTimeout(() => {
                    // Remove from wait queue on timeout
                    const idx = this.waitQueue.findIndex(w => w.reject === reject);
                    if (idx >= 0) this.waitQueue.splice(idx, 1);
                    
                    try {
                        const metricsService = require('./metricsService');
                        metricsService.metrics.browserPoolTimeoutsTotal.inc();
                    } catch (_) {}

                    console.timeEnd(`[BrowserPool] acquire:${requestId}`);
                    reject(new Error(`[BrowserPool] Acquire timeout after ${BROWSER_ACQUIRE_TIMEOUT_MS}ms. All browsers busy.`));
                }, BROWSER_ACQUIRE_TIMEOUT_MS);

                this.waitQueue.push({ resolve, reject, timer, requestId });
            });
        });
    }

    /**
     * Release a browser back to the pool and destroy the used context.
     * Triggers the next waiting request if the queue is non-empty.
     */
    async release(browserId, context, requestId = 'unknown', error = null) {
        const entry = this.pool.find(b => b.id === browserId);
        if (!entry) {
            logger.warn(`[BrowserPool] Release called for unknown browserId: ${browserId}`);
            return;
        }

        // Record metrics and score in reputation manager
        if (error) {
            const strategy = classifier.classify(error);
            const msg = error.message ? error.message.toLowerCase() : '';
            const isCrash = msg.includes('target closed') || msg.includes('session closed') || msg.includes('browser closed') || msg.includes('navigating to about:blank');
            if (strategy.action === 'quarantine' || error.constructor.name === 'CaptchaDetectedError') {
                repMgr.recordCaptcha(browserId);
            } else if (isCrash) {
                repMgr.recordCrash(browserId);
            } else {
                repMgr.recordTimeout(browserId);
            }
        } else {
            repMgr.recordSuccess(browserId);
        }

        // Destroy the incognito context — wipes all cookies, storage, and cache
        try {
            if (context && !context._closed) {
                await context.close();
                logger.info(`[BrowserPool] Incognito context destroyed. Session data wiped.`);
                try {
                    const { trace } = require('@opentelemetry/api');
                    const activeSpan = trace.getActiveSpan();
                    if (activeSpan) {
                        activeSpan.addEvent('browser_context_destroyed', { browserId });
                    }
                } catch (_) {}
            }
        } catch (err) {
            logger.warn(`[BrowserPool] Context close error (non-fatal): ${err.message}`);
        }

        // Check if browser has degraded reputation and needs to be recycled
        const shouldRecycle = repMgr.isQuarantined(browserId) || repMgr.shouldRecycleAfterJob(browserId) || repMgr.isRetired(browserId);
        if (shouldRecycle) {
            logger.warn(`[BrowserPool] Browser ${browserId} has degraded or retired reputation (trust: ${repMgr.getTrustScore(browserId)}). Recycling...`);
            const idx = this.pool.findIndex(b => b.id === browserId);
            if (idx >= 0) this.pool.splice(idx, 1);
            repMgr.retire(browserId);
            try { await entry.browser.close(); } catch (_) {}
            
            // Launch replacement browser to keep the pool size consistent
            this._launchBrowser().catch(err => logger.error(`[BrowserPool] Replacement launch failed: ${err.message}`));
        } else {
            entry.inUse = false;
            entry.lastUsed = Date.now();
            logger.info(`[BrowserPool] Browser ${browserId} released back to pool.`);
        }
        
        try {
            const metricsService = require('./metricsService');
            metricsService.metrics.browserPoolActiveContexts.set(this.getStatus().active);
        } catch (_) {}

        // Dequeue the next waiting request
        if (this.waitQueue.length > 0) {
            const freeBrowser = this.pool.find(b => !b.inUse);
            if (freeBrowser) {
                const next = this.waitQueue.shift();
                clearTimeout(next.timer);
                logger.info(`[BrowserPool] Serving queued request`);
                this._checkoutContext(freeBrowser, next.requestId).then(next.resolve).catch(next.reject);
            }
        }
    }

    /**
     * Get current pool status for metrics/health reporting.
     */
    adjustPoolSize() {
        const queueDepth = this.waitQueue.length;
        const minBrowsers = Math.min(1, MAX_BROWSERS);
        if (queueDepth > 1 && this.maxBrowsers < MAX_BROWSERS) {
            this.maxBrowsers++;
            logger.info(`[BrowserPool-Sizing] Scaling UP browser pool capacity to: ${this.maxBrowsers}`);
        } else if (queueDepth === 0 && this.maxBrowsers > minBrowsers) {
            this.maxBrowsers--;
            logger.info(`[BrowserPool-Sizing] Scaling DOWN browser pool capacity to: ${this.maxBrowsers}`);
        }
    }

    getStatus() {
        const active = this.pool.filter(b => b.inUse).length;
        const idle = this.pool.filter(b => !b.inUse).length;
        return {
            total: this.pool.length,
            active,
            idle,
            queued: this.waitQueue.length,
            maxBrowsers: this.maxBrowsers,
        };
    }

    /**
     * Graceful pool shutdown — wait for active jobs to finish, then close all browsers.
     */
    async shutdown() {
        this.isShuttingDown = true;
        logger.info('[BrowserPool] Initiating pool shutdown...');

        if (this.recycleInterval) {
            clearInterval(this.recycleInterval);
        }

        // Reject all waiting requests
        for (const waiter of this.waitQueue) {
            clearTimeout(waiter.timer);
            waiter.reject(new Error('[BrowserPool] Pool shutdown during wait.'));
        }
        this.waitQueue = [];

        // Close all browsers
        await Promise.allSettled(
            this.pool.map(async (entry) => {
                try {
                    await entry.browser.close();
                    logger.info(`[BrowserPool] Browser ${entry.id} closed.`);
                } catch (err) {
                    logger.warn(`[BrowserPool] Error closing browser ${entry.id}: ${err.message}`);
                }
            })
        );

        this.pool = [];
        logger.info('[BrowserPool] Pool shutdown complete.');
    }

    // ─── Private Methods ──────────────────────────────────────────────────────

    _logBrowserInfo(entry, prefix = 'Diagnostics', reason = '') {
        try {
            const proc = typeof entry.browser.process === 'function' ? entry.browser.process() : null;
            const pid = proc ? proc.pid : 'unknown';
            const exitCode = proc ? proc.exitCode : 'N/A';
            const signalCode = proc ? proc.signalCode : 'N/A';
            const uptime = Math.round((Date.now() - (entry.createdAt || entry.lastUsed)) / 1000);
            const connected = typeof entry.browser.isConnected === 'function' ? entry.browser.isConnected() : true;
            let openPagesCount = 'unknown';
            try {
                if (connected && typeof entry.browser.pages === 'function') {
                    openPagesCount = entry.browser._targets ? Object.keys(entry.browser._targets).length : 'unknown';
                }
            } catch (_) {}
            
            const os = require('os');
            const mem = process.memoryUsage();
            const sysFree = Math.round(os.freemem() / 1024 / 1024);
            const sysTotal = Math.round(os.totalmem() / 1024 / 1024);
            
            logger.info(`[BrowserPool] [${prefix}] ID: ${entry.id} | PID: ${pid} | Connected: ${connected} | ExitCode: ${exitCode} | SignalCode: ${signalCode} | OpenPages: ${openPagesCount} | Uptime: ${uptime}s | Reason: ${reason || 'N/A'} | Node RSS: ${Math.round(mem.rss/1024/1024)}MB | SysFree: ${sysFree}MB/${sysTotal}MB`);
        } catch (err) {
            logger.warn(`[BrowserPool] Error gathering browser diagnostics: ${err.message}`);
        }
    }

    // ─── Private Methods ──────────────────────────────────────────────────────

    async _launchBrowser() {
        return traceSpan('puppeteer.pool.launch', {
            'dependency.type': 'external',
            'dependency.name': 'chromium',
            'dependency.category': 'browser_automation',
            'dependency.criticality': 'high'
        }, async (span) => {
            const id = `browser-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
            span.setAttribute('browser.id', id);
            span.addEvent('browser_launched', { browserId: id });
            logger.info(`[BrowserPool] Launching new browser: ${id}`);
            console.time(`[BrowserPool] launch:${id}`);

            const executablePath = findChromiumExecutable();

            const browser = await puppeteer.launch({
                headless: true,
                executablePath: executablePath || undefined,
                args: this.launchArgs,
            });

            const proc = typeof browser.process === 'function' ? browser.process() : null;
            if (proc) {
                proc.on('exit', (code, signal) => {
                    logger.warn(`[BrowserPool] Browser process exited: id=${id} | PID=${proc.pid} | exitCode=${code} | signal=${signal}`);
                });
            }

            let version = 'unknown';
            try {
                if (typeof browser.version === 'function') {
                    version = await browser.version();
                }
            } catch (_) {}
            logger.info(`[BrowserPool] Browser ${id} version: ${version}`);

            const entry = { id, browser, lastUsed: Date.now(), createdAt: Date.now(), inUse: false };
            repMgr.registerBrowser(id);

            this._logBrowserInfo(entry, 'LAUNCH', `Browser launched successfully. Version: ${version}`);

            // Detect unexpected browser disconnect — auto-recover
            browser.on('disconnected', async () => {
                this._logBrowserInfo(entry, 'DISCONNECTED', 'Browser disconnected unexpectedly');
                repMgr.recordCrash(id);
                repMgr.retire(id);
                
                try {
                    const metricsService = require('./metricsService');
                    metricsService.metrics.browserCrashesTotal.inc();
                } catch (_) {}

                const idx = this.pool.findIndex(b => b.id === id);
                if (idx >= 0) this.pool.splice(idx, 1);
                
                try {
                    const metricsService = require('./metricsService');
                    metricsService.metrics.browserPoolActiveBrowsers.set(this.pool.length);
                } catch (_) {}

                // Release any waiters with recovery
                if (!this.isShuttingDown && this.waitQueue.length > 0) {
                    logger.info('[BrowserPool] Recovering — launching replacement browser for waiting requests...');
                    try {
                        const replacement = await this._launchBrowser();
                        const next = this.waitQueue.shift();
                        if (next) {
                            clearTimeout(next.timer);
                            this._checkoutContext(replacement, next.requestId).then(next.resolve).catch(next.reject);
                        }
                    } catch (recErr) {
                        logger.error(`[BrowserPool] Recovery browser launch failed: ${recErr.message}`);
                    }
                }
            });

            this.pool.push(entry);
            console.timeEnd(`[BrowserPool] launch:${id}`);
            try {
                const metricsService = require('./metricsService');
                metricsService.metrics.browserPoolActiveBrowsers.set(this.pool.length);
            } catch (_) {}
            logger.info(`[BrowserPool] Browser ${id} launched. Pool size: ${this.pool.length}`);
            return entry;
        });
    }

    async _checkoutContext(entry, requestId) {
        const startCheckout = Date.now();
        return traceSpan('puppeteer.pool.checkout', {
            'browser.id': entry.id,
            'dependency.type': 'external',
            'dependency.name': 'chromium',
            'dependency.category': 'browser_automation',
            'dependency.criticality': 'high'
        }, async (span) => {
            entry.inUse = true;
            entry.lastUsed = Date.now();

            // Validate browser is still healthy and not quarantined or retired
            const isConnected = typeof entry.browser.isConnected === 'function' ? entry.browser.isConnected() : true;
            const healthPassed = await this._healthCheck(entry);
            const quarantined = repMgr.isQuarantined(entry.id);
            const retired = repMgr.isRetired(entry.id);
            const healthy = isConnected && healthPassed && !quarantined && !retired;

            this._logBrowserInfo(entry, 'CHECKOUT_PRECHECK', `healthPassed=${healthPassed}, connected=${isConnected}, quarantined=${quarantined}, retired=${retired}`);

            if (!healthy) {
                const reason = `failed precheck: connected=${isConnected}, healthPassed=${healthPassed}, quarantined=${quarantined}, retired=${retired}`;
                this._logBrowserInfo(entry, 'RETIRE', reason);
                span.setAttribute('browser.healthy', false);
                const idx = this.pool.findIndex(b => b.id === entry.id);
                if (idx >= 0) this.pool.splice(idx, 1);
                repMgr.retire(entry.id);
                try { await entry.browser.close(); } catch (_) {}
                const newEntry = await this._launchBrowser();
                newEntry.inUse = true;
                entry = newEntry;
            }

            // Create a fresh incognito context — zero shared state with other students
            let context;
            try {
                context = await entry.browser.createBrowserContext();
            } catch (contextErr) {
                logger.error(`[BrowserPool] [${requestId}] Failed to create browser context: ${contextErr.message}. Re-launching browser...`);
                // Destroy current browser
                const idx = this.pool.findIndex(b => b.id === entry.id);
                if (idx >= 0) this.pool.splice(idx, 1);
                repMgr.retire(entry.id);
                try { await entry.browser.close(); } catch (_) {}

                // Launch replacement
                const newEntry = await this._launchBrowser();
                newEntry.inUse = true;
                entry = newEntry;

                // Retry context creation
                context = await entry.browser.createBrowserContext();
            }
            
            // Anti-bot stealth user-agent rotation
            const uas = [
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
            ];
            const selectedUa = uas[Math.floor(Math.random() * uas.length)];

            // Wrap context.newPage to apply anti-bot profiles, logging, and retry logic
            let originalNewPage = context.newPage.bind(context);
            context.newPage = async () => {
                const proc = typeof entry.browser.process === 'function' ? entry.browser.process() : null;
                const pid = proc ? proc.pid : 'unknown';
                const connected = typeof entry.browser.isConnected === 'function' ? entry.browser.isConnected() : true;
                const uptime = Math.round((Date.now() - (entry.createdAt || entry.lastUsed)) / 1000);
                
                let openPagesCount = 'unknown';
                try {
                    if (connected && typeof entry.browser.pages === 'function') {
                        openPagesCount = entry.browser._targets ? Object.keys(entry.browser._targets).length : 'unknown';
                    }
                } catch (_) {}

                // Log memory before page creation
                const os = require('os');
                const memBefore = process.memoryUsage();
                const sysFreeBefore = Math.round(os.freemem() / 1024 / 1024);
                logger.info(`[BrowserPool] [${requestId}] newPage called: browserId=${entry.id}, PID=${pid}, connected=${connected}, openPages=${openPagesCount}, uptime=${uptime}s | Node RSS Before: ${Math.round(memBefore.rss/1024/1024)}MB | SysFree Before: ${sysFreeBefore}MB`);

                if (!connected) {
                    logger.error(`[BrowserPool] [${requestId}] Browser disconnected before page creation. Destroying and launching a fresh browser...`);
                    
                    // Destroy current browser
                    const idx = this.pool.findIndex(b => b.id === entry.id);
                    if (idx >= 0) this.pool.splice(idx, 1);
                    repMgr.retire(entry.id);
                    try { await entry.browser.close(); } catch (_) {}

                    // Launch replacement browser
                    const newEntry = await this._launchBrowser();
                    
                    // Borrow the new browser's details for this active checkout session
                    entry.id = newEntry.id;
                    entry.browser = newEntry.browser;
                    entry.lastUsed = newEntry.lastUsed;
                    entry.createdAt = newEntry.createdAt;
                    entry.inUse = true;

                    logger.info(`[BrowserPool] [${requestId}] Re-creating context on replacement browser: ${newEntry.id}`);

                    // Recreate context and originalNewPage bound to new context
                    context = await entry.browser.createBrowserContext();
                    originalNewPage = context.newPage.bind(context);
                }

                try {
                    const page = await originalNewPage();
                    
                    const postPagesCount = entry.browser._targets ? Object.keys(entry.browser._targets).length : 'unknown';
                    const memAfter = process.memoryUsage();
                    const sysFreeAfter = Math.round(os.freemem() / 1024 / 1024);
                    logger.info(`[BrowserPool] [${requestId}] newPage success: browserId=${entry.id}, PID=${pid}, openPages=${postPagesCount} | Node RSS After: ${Math.round(memAfter.rss/1024/1024)}MB | SysFree After: ${sysFreeAfter}MB`);

                    await page.setUserAgent(selectedUa);
                    await page.setViewport({
                        width: 1280 + Math.floor(Math.random() * 100),
                        height: 800 + Math.floor(Math.random() * 100)
                    });

                    // SSRF Interceptor hook
                    const securityService = require('./securityService');
                    const originalGoto = page.goto.bind(page);
                    page.goto = async (urlStr, options) => {
                        const valid = await securityService.validateUrlForScraping(urlStr);
                        if (!valid) {
                            throw new Error(`[Security-SSRF] Blocked suspicious loopback/metadata scraper request to: ${urlStr}`);
                        }
                        return originalGoto(urlStr, options);
                    };

                    return page;
                } catch (pageErr) {
                    const errMsg = pageErr.message.toLowerCase();
                    const isTargetClosed = errMsg.includes('target closed') || errMsg.includes('createtarget') || errMsg.includes('disconnected') || errMsg.includes('target.createtarget');
                    
                    if (isTargetClosed) {
                        logger.error(`[BrowserPool] [${requestId}] Target closed / disconnected during newPage: ${pageErr.message}. Destroying browser and retrying...`);
                        this._logBrowserInfo(entry, 'DESTROY', `Target closed during page creation: ${pageErr.message}`);
                        
                        // Destroy current browser
                        const idx = this.pool.findIndex(b => b.id === entry.id);
                        if (idx >= 0) this.pool.splice(idx, 1);
                        repMgr.retire(entry.id);
                        try { await entry.browser.close(); } catch (_) {}

                        // Launch replacement browser
                        const newEntry = await this._launchBrowser();
                        
                        // Borrow the new browser's details for this active checkout session
                        entry.id = newEntry.id;
                        entry.browser = newEntry.browser;
                        entry.lastUsed = newEntry.lastUsed;
                        entry.createdAt = newEntry.createdAt;
                        entry.inUse = true;

                        logger.info(`[BrowserPool] [${requestId}] Re-creating context and retrying newPage on replacement browser: ${newEntry.id}`);

                        // Recreate context and page
                        context = await entry.browser.createBrowserContext();
                        const freshNewPage = context.newPage.bind(context);
                        const page = await freshNewPage();

                        const finalPagesCount = entry.browser._targets ? Object.keys(entry.browser._targets).length : 'unknown';
                        logger.info(`[BrowserPool] [${requestId}] newPage retry success: browserId=${entry.id}, openPages=${finalPagesCount}`);

                        await page.setUserAgent(selectedUa);
                        await page.setViewport({
                            width: 1280 + Math.floor(Math.random() * 100),
                            height: 800 + Math.floor(Math.random() * 100)
                        });

                        const securityService = require('./securityService');
                        const originalGoto = page.goto.bind(page);
                        page.goto = async (urlStr, options) => {
                            const valid = await securityService.validateUrlForScraping(urlStr);
                            if (!valid) {
                                throw new Error(`[Security-SSRF] Blocked suspicious loopback/metadata scraper request to: ${urlStr}`);
                            }
                            return originalGoto(urlStr, options);
                        };

                        return page;
                    } else {
                        throw pageErr;
                    }
                }
            };

            span.addEvent('browser_context_created', { browserId: entry.id });
            span.setAttribute('browser.context_checkout_duration_ms', Date.now() - startCheckout);
            
            try {
                const metricsService = require('./metricsService');
                metricsService.metrics.browserPoolActiveContexts.set(this.getStatus().active);
            } catch (_) {}

            logger.info(`[BrowserPool] Checked out browser ${entry.id} with fresh incognito context (stealth active).`);

            return { browserId: entry.id, context };
        });
    }

    async _healthCheck(entry) {
        try {
            // Simple check: can we query target list or open a blank page?
            const connected = typeof entry.browser.isConnected === 'function' ? entry.browser.isConnected() : true;
            if (!connected) return false;
            if (typeof entry.browser.pages === 'function') {
                await entry.browser.pages();
            }
            if (typeof entry.browser.version === 'function') {
                await entry.browser.version();
            }
            return true;
        } catch (err) {
            return false;
        }
    }

    async _recycleIdleBrowsers() {
        if (this.isShuttingDown) return;
        const now = Date.now();
        const toRecycle = this.pool.filter(b => !b.inUse && (now - b.lastUsed) > BROWSER_IDLE_RECYCLE_MS);

        for (const entry of toRecycle) {
            // Keep at least 1 browser warm
            if (this.pool.length <= 1) break;

            logger.info(`[BrowserPool] Recycling idle browser ${entry.id} (idle ${Math.round((now - entry.lastUsed) / 1000)}s).`);
            this._logBrowserInfo(entry, 'RETIRE', `Idle browser recycling (idle for ${Math.round((now - entry.lastUsed) / 1000)}s)`);
            
            try {
                const metricsService = require('./metricsService');
                metricsService.metrics.browserPoolRecycleTotal.inc();
            } catch (_) {}

            const idx = this.pool.findIndex(b => b.id === entry.id);
            if (idx >= 0) this.pool.splice(idx, 1);
            try { await entry.browser.close(); } catch (_) {}
        }

        if (toRecycle.length > 0) {
            try {
                const metricsService = require('./metricsService');
                metricsService.metrics.browserPoolActiveBrowsers.set(this.pool.length);
            } catch (_) {}
            logger.info(`[BrowserPool] Recycled ${toRecycle.length} idle browser(s). Pool size: ${this.pool.length}`);
        }
    }
}

const instance = new BrowserPool();
instance.findChromiumExecutable = findChromiumExecutable;
module.exports = instance;
