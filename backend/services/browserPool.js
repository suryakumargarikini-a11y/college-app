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

const MAX_BROWSERS = parseInt(process.env.BROWSER_POOL_SIZE || '3', 10);
const BROWSER_ACQUIRE_TIMEOUT_MS = parseInt(process.env.BROWSER_ACQUIRE_TIMEOUT_MS || '30000', 10);
const BROWSER_IDLE_RECYCLE_MS = parseInt(process.env.BROWSER_IDLE_RECYCLE_MS || '600000', 10); // 10 min

class BrowserPool {
    constructor() {
        this.pool = []; // Array of { id, browser, lastUsed, inUse }
        this.waitQueue = []; // Queued resolve functions waiting for a free slot
        this.recycleInterval = null;
        this.isShuttingDown = false;
        this.maxBrowsers = 3; // Starting max browsers (adaptive scaling up to 5)
        this.launchArgs = [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--disable-background-timer-throttling',
            '--disable-backgrounding-occluded-windows',
            '--disable-renderer-backgrounding',
            '--memory-pressure-off',
        ];
    }

    /**
     * Initialize the browser pool — pre-warms one browser to cut cold-start latency.
     */
    async init() {
        logger.info(`[BrowserPool] Initializing pool (MAX_BROWSERS=${MAX_BROWSERS})...`);
        try {
            // Pre-warm one browser instance
            await this._launchBrowser();
            logger.info('[BrowserPool] Pre-warmed 1 browser. Pool ready.');
        } catch (err) {
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

        logger.info(`[BrowserPool] Acquiring browser context...`);

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
                return await this._checkoutContext(freeBrowser, requestId);
            }

            // Pool not yet at capacity — launch a new browser
            if (this.pool.length < this.maxBrowsers) {
                const entry = await this._launchBrowser();
                return await this._checkoutContext(entry, requestId);
            }

            // All browsers busy — queue the request with a timeout
            logger.warn(`[BrowserPool] All ${this.maxBrowsers} browsers busy. Queuing request...`);
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
        if (queueDepth > 1 && this.maxBrowsers < 5) {
            this.maxBrowsers++;
            logger.info(`[BrowserPool-Sizing] Scaling UP browser pool capacity to: ${this.maxBrowsers}`);
        } else if (queueDepth === 0 && this.maxBrowsers > 3) {
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

            const browser = await puppeteer.launch({
                headless: 'new',
                args: this.launchArgs,
            });

            const entry = { id, browser, lastUsed: Date.now(), inUse: false };
            repMgr.registerBrowser(id);

            // Detect unexpected browser disconnect — auto-recover
            browser.on('disconnected', async () => {
                logger.error(`[BrowserPool] Browser ${id} disconnected unexpectedly. Removing from pool.`);
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
            const healthy = (await this._healthCheck(entry)) && !repMgr.isQuarantined(entry.id) && !repMgr.isRetired(entry.id);
            if (!healthy) {
                logger.warn(`[BrowserPool] Browser ${entry.id} failed health check, is quarantined, or is retired. Replacing...`);
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
            const context = await entry.browser.createBrowserContext();
            
            // Anti-bot stealth user-agent rotation
            const uas = [
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
            ];
            const selectedUa = uas[Math.floor(Math.random() * uas.length)];

            // Wrap context.newPage to apply anti-bot profiles and SSRF validation checks
            const originalNewPage = context.newPage.bind(context);
            context.newPage = async () => {
                const page = await originalNewPage();
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
            // Simple check: can we open a blank page?
            const pages = await entry.browser.pages();
            // If browser is disconnected, .pages() will throw
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

module.exports = new BrowserPool();
