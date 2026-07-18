'use strict';

/**
 * BrowserInstance — Single Chromium Browser Wrapper
 *
 * Wraps one browser process (Puppeteer or Playwright — via IBrowserProvider)
 * and tracks:
 *   - Health (connected, responsive)
 *   - Lifetime (job count, age in ms)
 *   - Reputation (via BrowserReputationManager)
 *
 * Provides clean checkout/checkin of isolated browser contexts.
 * Each checkout creates a fresh IContextAdapter — zero shared state between students.
 *
 * MIGRATION: This class no longer imports 'puppeteer' directly.
 * All browser-specific operations are delegated to the injected IBrowserProvider.
 * Switch providers by changing BROWSER_PROVIDER env var — no code change needed here.
 *
 * Lifecycle limits (configurable via env):
 *   BROWSER_MAX_JOBS        = 100      — force recycle after N jobs
 *   BROWSER_MAX_LIFETIME_MS = 1800000  — force recycle after N ms uptime (30 min)
 *
 * @module BrowserInstance
 */

const logger  = require('../logger');
const repMgr  = require('../../providers/scraper/browser/BrowserReputationManager');
const classifier = require('../../providers/scraper/retry/AdaptiveRetryClassifier');
const isolationValidator = require('./SessionIsolationValidator');

const MAX_JOBS_PER_BROWSER    = parseInt(process.env.BROWSER_MAX_JOBS || '100', 10);
const BROWSER_MAX_LIFETIME_MS = parseInt(
    process.env.BROWSER_MAX_LIFETIME_MS || String(30 * 60 * 1000),
    10
);

const STEALTH_USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
];

class BrowserInstance {
    /**
     * @param {Object} opts
     * @param {string}   opts.poolName    - 'AUTH_POOL' or 'SYNC_POOL'
     * @param {string[]} opts.launchArgs  - Chromium CLI flags
     * @param {Function} opts.onCrash     - Called with (this) on unexpected disconnect
     * @param {import('./providers/IBrowserProvider')} opts.provider - Injected browser provider
     */
    constructor({ poolName, launchArgs, onCrash, provider, generation }) {
        // Slot index: stable within a pool's lifetime. Format: auth_pool-1, auth_pool-2
        // Generation: increments each time this slot crashes and is replaced.
        // Together they uniquely identify every browser process:
        //   auth_pool-1-gen1 → crashes → auth_pool-1-gen2 → crashes → auth_pool-1-gen3
        //
        // Rule: same slot, different generation = different physical process.
        // Searching logs for 'auth_pool-1' gives all processes on that slot.
        // Searching for 'auth_pool-1-gen2' gives exactly one process's logs.
        const slotIndex  = (typeof generation === 'number' ? generation : 1);
        const slotName   = `${poolName.toLowerCase()}-${Date.now().toString(36)}`;
        this.id          = `${slotName}-gen${slotIndex}`;
        this.slotName    = slotName;   // stable across generations (same pool slot)
        this.generation  = slotIndex;  // increments on crash recovery
        this.poolName = poolName;
        this.launchArgs = launchArgs;
        this.onCrash  = onCrash;
        this.provider = provider;    // IBrowserProvider — never touch 'puppeteer' directly

        this.pid      = null;
        this.version  = 'unknown';

        this.createdAt    = 0;
        this.lastUsed     = 0;
        this.jobCount     = 0;
        this.launchTimeMs = 0;  // duration of last launch() call
        this.crashCount   = 0;  // incremented on 'disconnected' events

        this.inUse   = false;
        this.healthy = false;
        this.retired = false;

        /**
         * Active-job tracking — set at checkout(), cleared at checkin().
         * Enables BrowserPool to transparently retry an in-flight job when
         * the browser crashes mid-execution (student never sees the crash).
         */
        this._activeRequestId = null;   // REQ-XXXXX of the job currently running
        this._activeUserId    = null;   // student ID for session affinity re-routing
        this._activeResolve   = null;   // Promise resolve from the waiting acquire() call
        this._activeReject    = null;   // Promise reject from the waiting acquire() call
        this._crashRetryCount = 0;      // max 1 transparent retry per instance lifetime
    }

    // ─── Lifecycle ────────────────────────────────────────────────────────────

    /**
     * Launch the underlying Chromium process via the injected provider.
     * @param {string|undefined|null} executablePath
     * @returns {Promise<BrowserInstance>} this (fluent)
     */
    async launch(executablePath) {
        const t0 = Date.now();
        logger.info(`[POOL][${this.poolName}] Browser Creating: ${this.id} (provider=${this.provider.name})`);

        await this.provider.launch(executablePath, this.launchArgs);

        // Capture PID for diagnostics
        const proc = this.provider.process();
        this.pid = proc ? proc.pid : null;
        if (proc) {
            proc.on('exit', (code, signal) => {
                logger.warn(
                    `[POOL][${this.poolName}] Chromium process exited: ` +
                    `id=${this.id} pid=${this.pid} code=${code} signal=${signal}`
                );
            });
        }

        // Cache version string for diagnostics
        try { this.version = await this.provider.getVersion(); } catch (_) {}

        this.createdAt    = Date.now();
        this.lastUsed     = Date.now();
        this.healthy      = true;
        this.launchTimeMs = Date.now() - t0;

        repMgr.registerBrowser(this.id);

        this.provider.on('disconnected', () => {
            if (this.retired) return; // already being cleaned up

            this.crashCount++;
            logger.warn(`[POOL][${this.poolName}] Browser Destroyed (crashed): ${this.id}`);
            repMgr.recordCrash(this.id);
            repMgr.retire(this.id);
            this.healthy = false;
            this.retired = true;

            try { this.onCrash(this); } catch (_) {}

            try {
                require('../metricsService').metrics.browserCrashesTotal.inc();
            } catch (_) {}
        });

        const elapsed = Date.now() - t0;
        logger.info(
            `[POOL][${this.poolName}] Browser Ready: ${this.id} ` +
            `provider=${this.provider.name} v=${this.version} pid=${this.pid} launch_ms=${elapsed}`
        );

        // Record launch duration metric
        try {
            require('../metricsService').metrics.browserLaunchDurationSeconds
                .observe({ provider: this.provider.name }, elapsed / 1000);
        } catch (_) {}

        return this;
    }

    /**
     * Forcefully close the browser and mark as retired.
     * @param {string} [reason='manual']
     */
    async destroy(reason = 'manual') {
        if (this.retired) return; // idempotent
        this.retired = true;
        this.healthy = false;
        repMgr.retire(this.id);
        logger.info(`[POOL][${this.poolName}] Browser Destroyed: ${this.id} reason=${reason}`);
        try { await this.provider.close(); } catch (_) {}
    }

    // ─── Health ───────────────────────────────────────────────────────────────

    /**
     * Synchronous health check — delegates to provider.isConnected().
     * NEVER calls async RPC (prevents TOCTOU Target-closed race).
     *
     * @returns {boolean}
     */
    isHealthy() {
        if (this.retired || !this.provider) return false;
        try {
            return this.provider.isConnected();
        } catch (_) {
            return false;
        }
    }

    needsRecycle() {
        if (this.retired || !this.healthy) return true;
        if (this.jobCount >= MAX_JOBS_PER_BROWSER) return true;
        if (this.createdAt && (Date.now() - this.createdAt) >= BROWSER_MAX_LIFETIME_MS) return true;
        if (repMgr.isQuarantined(this.id) || repMgr.isRetired(this.id)) return true;
        return false;
    }

    // ─── Context checkout / checkin ───────────────────────────────────────────

    /**
     * Create a fresh isolated context (IContextAdapter) for one job.
     *
     * @param {string} requestId - Correlation ID
     * @returns {Promise<{ context: import('./providers/adapters/IContextAdapter'), ua: string }>}
     * @throws {Error} if browser is not healthy at checkout time
     */
    async checkout(requestId) {
        this.inUse    = true;
        this.lastUsed = Date.now();
        this.jobCount++;

        // Track the active job so crash recovery can retry it
        this._activeRequestId = requestId;

        logger.info(
            `[POOL][${this.poolName}] Browser Busy: ${this.id} ` +
            `job=#${this.jobCount} req=${requestId}`
        );

        // Synchronous health gate — no async RPC race
        if (!this.isHealthy()) {
            this.inUse = false;
            throw new Error(
                `[BrowserInstance] ${this.id} is not connected at checkout (req=${requestId})`
            );
        }

        // Stealth UA rotated per context
        const ua = STEALTH_USER_AGENTS[Math.floor(Math.random() * STEALTH_USER_AGENTS.length)];
        const viewport = {
            width:  1280 + Math.floor(Math.random() * 100),
            height:  800 + Math.floor(Math.random() * 100),
        };

        let context;
        try {
            context = await this.provider.createContext(ua, viewport);
        } catch (ctxErr) {
            this.inUse   = false;
            this.healthy = false;

            const isTargetClosed =
                ctxErr.message.includes('Target closed') ||
                ctxErr.message.includes('Session closed') ||
                ctxErr.message.includes('Browser closed') ||
                ctxErr.message.includes('Target page, context or browser has been closed');

            if (isTargetClosed && !this.retired) {
                this.retired = true;
                logger.warn(
                    `[POOL][${this.poolName}] createContext() → browser closed on ${this.id}. ` +
                    `Triggering crash recovery. req=${requestId}`
                );
                try { this.onCrash(this); } catch (_) {}
            }

            throw new Error(
                `[BrowserInstance] ${this.id} createContext() failed: ${ctxErr.message} (req=${requestId})`
            );
        }

        // ── Session Isolation: verify fresh context has zero pre-existing cookies ──
        // A cookie found here means a previous student's session leaked into this context.
        // In ISOLATION_STRICT=true mode this throws; otherwise logs as critical error.
        isolationValidator.verifyFreshContext(context, {
            requestId,
            browserId: this.id,
        }).catch(() => {}); // non-blocking; verifyFreshContext never throws in non-strict mode

        return { context, ua };
    }

    /**
     * Close the context and release the browser back to idle.
     *
     * @param {import('./providers/adapters/IContextAdapter')|null} context
     * @param {Error|null} [error=null]
     */
    async checkin(context, error = null) {
        // Update reputation
        if (error) {
            const strategy = classifier.classify(error);
            const msg = (error.message || '').toLowerCase();
            const isCrash =
                msg.includes('target closed') ||
                msg.includes('session closed') ||
                msg.includes('browser closed') ||
                msg.includes('target page, context or browser has been closed');

            if (strategy.action === 'quarantine' || error.constructor.name === 'CaptchaDetectedError') {
                repMgr.recordCaptcha(this.id);
            } else if (isCrash) {
                repMgr.recordCrash(this.id);
            } else {
                repMgr.recordTimeout(this.id);
            }
        } else {
            repMgr.recordSuccess(this.id);
        }

        // Close context — IContextAdapter.close() owns its own closed-flag guard.
        if (context) {
            try {
                await context.close();
            } catch (closeErr) {
                logger.warn(
                    `[POOL][${this.poolName}] Context close warning (non-fatal): ${closeErr.message}`
                );
            }

            // ── Session Isolation: verify context is fully destroyed ──────────
            // Runs asynchronously — never blocks the release of the browser slot.
            isolationValidator.verifyContextDestroyed(context, {
                requestId: 'checkin',
                browserId: this.id,
            }).catch(() => {});
        }

        this.inUse    = false;
        this.lastUsed = Date.now();

        // Clear active-job tracking once job completes normally
        this._activeRequestId = null;
        this._activeUserId    = null;
        this._activeResolve   = null;
        this._activeReject    = null;

        logger.info(
            `[POOL][${this.poolName}] Browser Released: ${this.id} ` +
            `total_jobs=${this.jobCount}`
        );
    }

    // ─── Diagnostics ──────────────────────────────────────────────────────────

    /**
     * Returns a plain stats object for the /api/browserpool health endpoint.
     * Includes provider name, crash count, launch time, and OS memory so the
     * monitoring dashboard can show full browser health without needing SSH.
     *
     * @returns {Object}
     */
    getStats() {
        const uptimeSec = this.createdAt
            ? Math.round((Date.now() - this.createdAt) / 1000)
            : 0;
        const idleSec = this.lastUsed
            ? Math.round((Date.now() - this.lastUsed) / 1000)
            : 0;

        // Derive human-readable status
        let status;
        if (this.retired)      status = 'retired';
        else if (!this.healthy) status = 'unhealthy';
        else if (this.inUse)   status = 'busy';
        else                   status = 'idle';

        // Try to read browser process memory (Linux: /proc/<pid>/status, best-effort)
        const browserMemoryMb = this._getBrowserMemoryMb();

        return {
            id:             this.id,
            slotName:       this.slotName,
            generation:     this.generation,
            poolName:       this.poolName,
            provider:       this.provider ? this.provider.name : 'unknown',
            status,
            pid:            this.pid,
            browserVersion: this.version,
            inUse:          this.inUse,
            healthy:        this.healthy,
            retired:        this.retired,
            jobCount:       this.jobCount,
            maxJobs:        MAX_JOBS_PER_BROWSER,
            crashCount:     this.crashCount,
            launchTimeMs:   this.launchTimeMs,
            uptimeSec,
            idleSec,
            lastUsed:       this.lastUsed ? new Date(this.lastUsed).toISOString() : null,
            browserMemoryMb,
            // Active job — populated when status='busy'
            activeRequestId: this._activeRequestId || null,
        };
    }

    /**
     * Read browser process RSS memory from the OS.
     * Linux only (reads /proc/<pid>/status). Returns null on Windows/macOS.
     * Never throws.
     *
     * @returns {number|null}
     */
    _getBrowserMemoryMb() {
        if (!this.pid || process.platform !== 'linux') return null;
        try {
            const fs     = require('fs');
            const status = fs.readFileSync(`/proc/${this.pid}/status`, 'utf8');
            const match  = status.match(/VmRSS:\s+(\d+)\s+kB/);
            return match ? Math.round(parseInt(match[1], 10) / 1024) : null;
        } catch (_) {
            return null;
        }
    }
}

module.exports = BrowserInstance;
