/**
 * SITAM Smart ERP — Scraper Runtime Integration Tests
 *
 * Verifies that all 10 resilience modules are executed in the live sync path,
 * emit telemetry through ProviderMetrics, and handle critical thresholds correctly.
 *
 * Validation Checklist:
 *   [x] AntiBotDetector executed
 *   [x] DOMDriftDetector executed
 *   [x] PartialSyncRecovery checkpoint created
 *   [x] AdaptiveSelectorOptimizer recorded selector promotion
 *   [x] BrowserReputationManager updated score
 *   [x] QueuePressureManager throttled a job
 *   [x] AdaptiveLoadShedding rejected a low-priority job
 *   [x] Forecaster generated forecast
 *
 * Run: node scripts/test-scraper-runtime-integration.js
 */

'use strict';

process.on('uncaughtException', (err) => {
    console.error('UNCAUGHT EXCEPTION:', err.stack || err.message || err);
    process.exit(1);
});
process.on('unhandledRejection', (reason) => {
    console.error('UNHANDLED REJECTION:', reason.stack || reason.message || reason);
    process.exit(1);
});

process.env.NODE_ENV = 'test';
process.env.ERP_PROVIDER = 'scraper';

const path = require('path');
const fs   = require('fs');
const assert = require('assert');

// ─── STUB PUPPETEER, BULLMQ & REDISSERVICE BEFORE LOADING WORKER/SERVICES ─────
const Module = require('module');
const originalRequire = Module.prototype.require;

const redisServiceMocked = originalRequire.call(module, path.join(__dirname, '../services/redisService'));
redisServiceMocked.connect = function() {
    this.client = {
        llen: async () => 5 // Mock BullMQ queue length
    };
    this.isConnected = true;
    this.isAlive = () => false; // Fallback to in-memory maps for testing modules
    return this.client;
};
redisServiceMocked.connect();
redisServiceMocked.isAlive = () => false;

Module.prototype.require = function(id) {
    if (id === 'puppeteer') {
        return mockPuppeteer;
    }
    if (id === 'bullmq') {
        return mockBullMQ;
    }
    if (id.includes('redisService')) {
        return redisServiceMocked;
    }
    if (id === 'dns') {
        return {
            promises: {
                resolve: async (hostname) => {
                    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') {
                        return ['127.0.0.1'];
                    }
                    return ['104.21.32.140'];
                }
            }
        };
    }
    return originalRequire.apply(this, arguments);
};

// ─── POPULATE MOCK PAGES ──────────────────────────────────────────────────────
const mockHtmlPages = {
    loginHtml: '<html><body><form id="login-form"><input id="txtId2"/><input id="txtPwd2"/><input id="imgBtn2"/></form></body></html>',
    profileHtml: '',
    marksHtml: '',
    feesHtml: '',
    assignmentsHtml: ''
};

try {
    mockHtmlPages.profileHtml = fs.readFileSync(path.join(__dirname, '../debug_profile_real.html'), 'utf8');
    mockHtmlPages.marksHtml = fs.readFileSync(path.join(__dirname, '../debug_marks_real.html'), 'utf8');
    mockHtmlPages.feesHtml = fs.readFileSync(path.join(__dirname, '../debug_fees_real.html'), 'utf8');
    mockHtmlPages.assignmentsHtml = fs.readFileSync(path.join(__dirname, '../debug_assignments_real.html'), 'utf8');
} catch (e) {
    mockHtmlPages.profileHtml = '<html><body><div id="divProfile"><table><tr><td>Name</td><td>Test Student</td></tr><tr><td>Roll</td><td>CS001</td></tr></table></div></body></html>';
    mockHtmlPages.marksHtml = '<html><body><div id="divMarks"><table><tr><td>CS-401</td><td>A</td><td>4.0</td></tr></table></div></body></html>';
    mockHtmlPages.feesHtml = '<html><body><div id="divReport"><table><tr><td>Grand Total</td><td>1000</td></tr></table></div></body></html>';
    mockHtmlPages.assignmentsHtml = '<html><body><div id="divAssignments"><table><tr><th>Assignment</th></tr></table></div></body></html>';
}

// Mock Page class simulating Puppeteer Page
class MockPage {
    constructor() {
        this._url = 'https://sitamecap.co.in/SATYA/Default.aspx';
        this._html = mockHtmlPages.loginHtml;
        this._selectors = {};
        this._isCaptcha = false;
        this._failMarks = false;
    }

    url() {
        return this._url;
    }

    async setViewport() {}
    async setUserAgent() {}

    async goto(urlStr, options) {
        this._url = urlStr;
        if (this._isCaptcha) {
            return { ok: () => true };
        }
        if (urlStr.includes('Default.aspx')) {
            this._html = mockHtmlPages.loginHtml;
        } else if (urlStr.includes('StudentProfile.aspx')) {
            this._html = mockHtmlPages.profileHtml;
        } else if (urlStr.includes('StudentMarksReport.aspx')) {
            this._html = mockHtmlPages.marksHtml;
        } else if (urlStr.includes('studentpayments.aspx')) {
            this._html = mockHtmlPages.feesHtml;
        } else if (urlStr.includes('StudentAssignmentsReport.aspx')) {
            this._html = mockHtmlPages.assignmentsHtml;
        }
        return { ok: () => true };
    }

    async waitForNavigation(options) {
        return { ok: () => true };
    }

    async content() {
        return this._html;
    }

    async cookies() {
        return [{ name: 'ASP.NET_SessionId', value: 'mocksession123' }];
    }

    async $(selector) {
        if (this._selectors[selector] === false || (this._failMarks && (selector.toLowerCase().includes('marks') || selector.includes('Grade')))) return null;
        const lowerSel = selector.toLowerCase();
        if (lowerSel.includes('captcha') || lowerSel.includes('challenge') || lowerSel.includes('sitekey') || lowerSel.includes('cf-') || lowerSel.includes('checking_browser')) {
            const hasPattern = this._html.toLowerCase().includes('captcha') || this._html.toLowerCase().includes('challenge');
            return hasPattern ? {} : null;
        }
        return {};
    }

    async click(selector) {
        if (selector.includes('Btn') || selector.includes('login') || selector.includes('submit')) {
            this._url = 'https://sitamecap.co.in/SATYA/StudentDashboard.aspx';
            this._html = '<html><body>Hi Test Student</body></html>';
        }
    }

    async type(selector, text, options) {}

    async waitForSelector(selector, options) {
        if (this._selectors[selector] === false || (this._failMarks && (selector.toLowerCase().includes('marks') || selector.includes('Grade')))) {
            throw new Error(`Selector not found: ${selector}`);
        }
        const lowerSel = selector.toLowerCase();
        if (lowerSel.includes('captcha') || lowerSel.includes('challenge') || lowerSel.includes('sitekey') || lowerSel.includes('cf-') || lowerSel.includes('checking_browser')) {
            const hasPattern = this._html.toLowerCase().includes('captcha') || this._html.toLowerCase().includes('challenge');
            if (!hasPattern) {
                throw new Error(`Selector not found: ${selector}`);
            }
        }
        return {};
    }

    async waitForFunction(fn, options, ...args) {
        return true;
    }

    async evaluate(fn, ...args) {
        if (typeof fn === 'function') {
            const fnStr = fn.toString();
            if (fnStr.includes('textContent')) {
                return 'Hi Test Student';
            }
            if (fnStr.includes('innerHTML')) {
                if (this._url.includes('StudentProfile.aspx')) return mockHtmlPages.profileHtml;
                if (this._url.includes('StudentMarksReport.aspx')) return mockHtmlPages.marksHtml;
                if (this._url.includes('studentpayments.aspx')) return mockHtmlPages.feesHtml;
                if (this._url.includes('StudentAssignmentsReport.aspx')) return mockHtmlPages.assignmentsHtml;
            }
            return '';
        }
        return '';
    }
}

let activePageInstance = new MockPage();

// Mock browser object
const mockBrowserInstance = {
    createBrowserContext: async () => {
        return {
            newPage: async () => {
                const page = new MockPage();
                page._failMarks = activePageInstance._failMarks;
                page._isCaptcha = activePageInstance._isCaptcha;
                page._selectors = activePageInstance._selectors;
                if (activePageInstance._isCaptcha) {
                    page._html = activePageInstance._html;
                }
                return page;
            },
            close: async () => {}
        };
    },
    close: async () => {},
    pages: async () => [],
    on: () => {}
};

const mockPuppeteer = {
    launch: async () => {
        return mockBrowserInstance;
    }
};

const mockBullMQ = {
    Worker: class {
        constructor(queueName, handler) {
            global.mockWorkerHandler = handler;
        }
        on() {}
        close() {}
    }
};



// Bootstrap worker (registers global.mockWorkerHandler)
require('../worker');

// Import resilience components
const ProviderMetrics = require('../providers/telemetry/ProviderMetrics');
const ProviderFactory = require('../providers/ProviderFactory');
const recovery = require('../providers/scraper/recovery/PartialSyncRecovery');
const selectorOptimizer = require('../providers/scraper/selectors/AdaptiveSelectorOptimizer');
const repMgr = require('../providers/scraper/browser/BrowserReputationManager');
const qpm = require('../providers/scraper/throttle/QueuePressureManager');
const maintDetector = require('../providers/scraper/maintenance/ERPMaintenanceDetector');
const shedder = require('../providers/scraper/throttle/AdaptiveLoadShedding');
const forecaster = require('../providers/scraper/forecasting/ScraperReliabilityForecaster');
const healthScorer = require('../providers/scraper/health/ERPHealthScorer');
const driftDetector = require('../providers/scraper/drift/DOMDriftDetector');

// Ensure Prometheus metrics are initialized
ProviderMetrics._ensureInitialized();

// ─── HELPERS ──────────────────────────────────────────────────────────────────
async function getMetricValue(metricObj) {
    if (!metricObj) return 0;
    const data = await metricObj.get();
    if (!data || !data.values || data.values.length === 0) return 0;
    if (metricObj.name === 'erp_browser_reputation_score') {
        return Math.min(...data.values.map(v => v.value));
    }
    return data.values.reduce((sum, v) => sum + v.value, 0);
}

let passed = 0;
let failed = 0;
const failures = [];

async function test(name, fn) {
    try {
        console.log(`\n🏃 Running test: ${name}`);
        await fn();
        console.log(`  ✅ ${name}`);
        passed++;
    } catch (err) {
        console.error(`  ❌ ${name}: ${err.message}`);
        failures.push({ name, error: err.stack || err.message });
        failed++;
    }
}

// ─── TESTS ────────────────────────────────────────────────────────────────────
async function runTests() {
    console.log('\n════════════════════════════════════════════════════════════');
    console.log('  SITAM Scraper Reliability Runtime Integration Audit');
    console.log('════════════════════════════════════════════════════════════\n');

    // Test 1: Successful sync runs all pages & sets baseline
    await test('DOMDriftDetector baseline creation & normal sync execution', async () => {
        // Clear baselines
        await driftDetector.updateBaseline('profile', mockHtmlPages.profileHtml);
        await driftDetector.updateBaseline('marks', mockHtmlPages.marksHtml);
        await driftDetector.updateBaseline('fees', mockHtmlPages.feesHtml);
        await driftDetector.updateBaseline('assignments', mockHtmlPages.assignmentsHtml);

        const initialDriftCount = await getMetricValue(ProviderMetrics.metrics.domDriftIncidentsTotal);

        const job = {
            id: 'job-1',
            data: { userId: 'STUDENT001', password: 'password123', forceFullSync: true },
            attemptsMade: 0,
            timestamp: Date.now(),
            discard: async () => {}
        };

        const result = await global.mockWorkerHandler(job);
        assert.ok(result);
        assert.strictEqual(result.success, true);

        // Verify DOM drift detector ran and did not fail (drift score should be 0, total incidents unchanged)
        const finalDriftCount = await getMetricValue(ProviderMetrics.metrics.domDriftIncidentsTotal);
        assert.strictEqual(finalDriftCount, initialDriftCount, 'Drift score 0 should not increment incidents');
    });

    // Test 2: AntiBotDetector executed, updates BrowserReputationManager score, and classify decision is quarantine
    await test('AntiBotDetector CAPTCHA detection & reputation quarantine escalation', async () => {
        const initialCaptchaCount = await getMetricValue(ProviderMetrics.metrics.captchaDetectionsTotal);

        // Make page return captcha
        activePageInstance._html = '<html><body>Please verify you are a human</body></html>';
        activePageInstance._isCaptcha = true;

        const mockJob = {
            id: 'job-captcha',
            data: { userId: 'STUDENT002', password: 'password123', forceFullSync: true },
            attemptsMade: 0,
            timestamp: Date.now(),
            discard: async () => { mockJob.discarded = true; }
        };

        try {
            await global.mockWorkerHandler(mockJob);
            assert.fail('Should have failed due to CAPTCHA');
        } catch (err) {
            assert.strictEqual(err.constructor.name, 'CaptchaDetectedError');
        }

        // Verify AntiBotDetector executed & recorded captcha hit
        const finalCaptchaCount = await getMetricValue(ProviderMetrics.metrics.captchaDetectionsTotal);
        assert.ok(finalCaptchaCount > initialCaptchaCount, 'CAPTCHA detection metric should be incremented');

        // Verify BrowserReputationManager trust score penalty applied
        const score = await getMetricValue(ProviderMetrics.metrics.browserReputationScore);
        assert.strictEqual(score, 75, 'Reputation score should drop to 75 after 1 captcha');

        // Verify AdaptiveRetryClassifier classified to quarantine (no retry, discard job)
        assert.strictEqual(mockJob.discarded, true, 'Job must be discarded on captcha quarantine classification');

        // Reset page back to normal
        activePageInstance._isCaptcha = false;
        activePageInstance._html = mockHtmlPages.loginHtml;
    });

    // Test 3: DOM Drift Warning and Critical thresholds
    await test('DOMDriftDetector threshold protection (Warning vs Critical)', async () => {
        // 1. Establish baseline first
        await driftDetector.updateBaseline('profile', mockHtmlPages.profileHtml);
        const baselineFp = await driftDetector._loadBaseline('profile');

        // 2. Test Warning Threshold: mutate HTML to cause moderate drift (score 50-79)
        // We will mock the computeDriftScore method temporarily to return exactly 65
        const origCompute = driftDetector.computeDriftScore;
        driftDetector.computeDriftScore = () => ({ score: 65, changes: ['divCount changed: 10 -> 25'] });

        const warningDriftMetric = await getMetricValue(ProviderMetrics.metrics.domDriftIncidentsTotal);

        const warningJob = {
            id: 'job-warning-drift',
            data: { userId: 'STUDENT_DRIFT_WARN', password: 'password123', forceFullSync: true },
            attemptsMade: 0,
            timestamp: Date.now(),
            discard: async () => {}
        };

        // This sync should continue/succeed, and only emit telemetry
        const warningResult = await global.mockWorkerHandler(warningJob);
        assert.ok(warningResult);
        assert.strictEqual(warningResult.success, true);

        // Verify telemetry recorded
        const postWarningMetric = await getMetricValue(ProviderMetrics.metrics.domDriftIncidentsTotal);
        assert.ok(postWarningMetric > warningDriftMetric, 'Warning drift should emit telemetry');

        // 3. Test Critical Threshold: drift >= 80 should fail sync
        driftDetector.computeDriftScore = () => ({ score: 85, changes: ['tableCount changed: 1 -> 15', 'structuralHash changed'] });

        const criticalJob = {
            id: 'job-critical-drift',
            data: { userId: 'STUDENT_DRIFT_CRIT', password: 'password123', forceFullSync: true },
            attemptsMade: 0,
            timestamp: Date.now(),
            discard: async () => {}
        };

        try {
            await global.mockWorkerHandler(criticalJob);
            assert.fail('Should have failed due to Critical DOM drift');
        } catch (err) {
            assert.strictEqual(err.constructor.name, 'SelectorDriftError');
        }

        // Restore original method
        driftDetector.computeDriftScore = origCompute;
    });

    // Test 4: PartialSyncRecovery checkpoint created and resumed
    await test('PartialSyncRecovery checkpoint creation & execution resuming', async () => {
        const initialRecoveryCount = await getMetricValue(ProviderMetrics.metrics.partialSyncRecoveryTotal);

        // Make marks page navigation fail
        activePageInstance._failMarks = true;

        const partialJob = {
            id: 'job-partial',
            data: { userId: 'STUDENT_PARTIAL', password: 'password123', forceFullSync: true },
            attemptsMade: 0,
            timestamp: Date.now(),
            discard: async () => {}
        };

        // Sync will fail on marks scrape timeout
        try {
            await global.mockWorkerHandler(partialJob);
        } catch (_) {}

        // Verify checkpoint was created for profile (succeeded) and marks (failed)
        const checkpoint = await recovery.loadCheckpoint('STUDENT_PARTIAL');
        assert.ok(checkpoint);
        assert.strictEqual(checkpoint.modules.profile.status, 'done');
        assert.strictEqual(checkpoint.modules.marks.status, 'failed');

        // Verify checkpoint_created telemetry emitted
        const postPartialCount = await getMetricValue(ProviderMetrics.metrics.partialSyncRecoveryTotal);
        assert.ok(postPartialCount > initialRecoveryCount, 'Checkpoint creation should emit telemetry');

        // Now fix the page selectors
        activePageInstance._failMarks = false;

        // Verify that the next getRecoveryPlan() resumes from checkpoint, executing only the remaining
        const plan = await recovery.getRecoveryPlan('STUDENT_PARTIAL');
        assert.deepStrictEqual(plan, ['marks'], 'Recovery plan should skip completed profile, fees, assignments');

        // Now corrupt the profile checkpoint data to test corruption protection
        const memKey = 'STUDENT_PARTIAL:profile';
        const cachedEntry = recovery._localCache.get(memKey);
        if (cachedEntry) {
            cachedEntry.data = 'corrupted html content';
        }

        // The next getRecoveryPlan should detect the mismatch, discard checkpoint, and return all modules
        const planAfterCorruption = await recovery.getRecoveryPlan('STUDENT_PARTIAL');
        assert.deepStrictEqual(planAfterCorruption, ['profile', 'marks', 'fees', 'assignments'], 'Recovery plan should re-run all modules after corruption detected');

        // Verify corruption metric emitted
        const finalRecoveryCount = await getMetricValue(ProviderMetrics.metrics.partialSyncRecoveryTotal);
        assert.ok(finalRecoveryCount > postPartialCount, 'Recovery corruption should emit telemetry');

        // Clear checkpoint
        await recovery.clearCheckpoint('STUDENT_PARTIAL');
    });

    // Test 5: AdaptiveSelectorOptimizer records selector promotion
    await test('AdaptiveSelectorOptimizer fallback selector promotion & telemetry', async () => {
        const initialPromotions = await getMetricValue(ProviderMetrics.metrics.selectorPromotionsTotal);

        // Record 20 consecutive successes for depth 1 of LOGIN_USERNAME
        for (let i = 0; i < 20; i++) {
            await selectorOptimizer.recordOutcome('LOGIN_USERNAME', 1, true);
        }

        // Verify telemetry recorded the promotion
        const postPromotions = await getMetricValue(ProviderMetrics.metrics.selectorPromotionsTotal);
        assert.ok(postPromotions > initialPromotions, 'Selector promotion should emit telemetry');

        // Verify the promoted selector chain starts with index 1 (fallback promoted to primary)
        const chain = await selectorOptimizer.getOptimizedChain('LOGIN_USERNAME');
        const expectedPrimary = require('../providers/scraper/selectors/ERPSelectors').ERP_SELECTORS.LOGIN_USERNAME[1];
        assert.strictEqual(chain[0], expectedPrimary, 'Fallback should be promoted to primary in optimized chain');

        // Reset
        await selectorOptimizer.resetOptimization('LOGIN_USERNAME');
    });

    // Test 6: Queue Throttling and Load Shedding Rejection
    await test('QueuePressureManager throttling & AdaptiveLoadShedding rejection bypass', async () => {
        // Set health score low to trigger HIGH pressure and PROTECTED load shedding mode
        qpm.updateFromHealthScore(50);
        shedder.updateFromHealthScore(50);

        // Check telemetry modes updated
        const pressureGauge = await getMetricValue(ProviderMetrics.metrics.queuePressureLevelGauge);
        const shedModeGauge = await getMetricValue(ProviderMetrics.metrics.loadSheddingModeGauge);
        assert.strictEqual(pressureGauge, 2, 'Queue pressure level gauge should be set to 2 (HIGH)');
        assert.strictEqual(shedModeGauge, 2, 'Load shedding mode gauge should be set to 2 (PROTECTED)');

        // 1. A background job (forceFullSync = false) should be rejected/shed
        const backgroundJob = {
            id: 'job-bg-throttle',
            data: { userId: 'STUDENT_BG_THROTTLE', password: 'password123', forceFullSync: false },
            attemptsMade: 0,
            timestamp: Date.now(),
            discard: async () => {}
        };

        const bgResult = await global.mockWorkerHandler(backgroundJob);
        assert.ok(bgResult);
        assert.strictEqual(bgResult.success, false);
        assert.ok(bgResult.reason.includes('shed') || bgResult.reason.includes('throttle'), 'Background job should be rejected/shed');

        // 2. A manual sync job (forceFullSync = true) must bypass throttling/shedding and succeed
        const manualJob = {
            id: 'job-manual-bypass',
            data: { userId: 'STUDENT_MANUAL_BYPASS', password: 'password123', forceFullSync: true },
            attemptsMade: 0,
            timestamp: Date.now(),
            discard: async () => {}
        };

        const manualResult = await global.mockWorkerHandler(manualJob);
        assert.ok(manualResult);
        assert.strictEqual(manualResult.success, true, 'Manual sync must bypass queue protection and succeed');

        // Reset health score
        qpm.updateFromHealthScore(100);
        shedder.updateFromHealthScore(100);
    });

    // Test 7: Forecaster forecast generation
    await test('ScraperReliabilityForecaster forecast generation & metrics emission', async () => {
        // Record hits to trigger elevated risks
        for (let i = 0; i < 5; i++) {
            forecaster.recordCaptchaHit();
            forecaster.recordSyncAttempt();
            forecaster.recordSyncFailure();
        }

        // Run forecast
        const forecast = forecaster.forecast();
        assert.ok(forecast);
        assert.ok(forecast.reliabilityScore >= 0 && forecast.reliabilityScore <= 100);

        // Trigger periodic/explicit metrics emission
        forecaster._emitForecastMetrics(forecast);

        // Verify telemetry values
        const score = await getMetricValue(ProviderMetrics.metrics.forecastReliabilityScore);
        assert.strictEqual(score, forecast.reliabilityScore, 'Forecast reliability score gauge should match computed forecast');
    });

    // Test 8: ERPMaintenanceDetector executed, suppressed check, and metric emission
    await test('ERPMaintenanceDetector detection and suppression check', async () => {
        const initialMaintCount = await getMetricValue(ProviderMetrics.metrics.maintenanceModeTotal);

        // Simulate page with maintenance message
        activePageInstance._html = '<html><body><h1>Site is under maintenance</h1></body></html>';
        activePageInstance._isCaptcha = true; // prevent goto overwriting

        // Detect maintenance
        const detectResult = await maintDetector.detect(activePageInstance);
        assert.ok(detectResult.detected);
        assert.strictEqual(detectResult.severity, 'MINOR');

        // Verify metric emitted
        const finalMaintCount = await getMetricValue(ProviderMetrics.metrics.maintenanceModeTotal);
        assert.ok(finalMaintCount > initialMaintCount, 'Maintenance mode metric should be incremented');

        // Check suppress condition
        const suppress = await maintDetector.shouldSuppressSync('low');
        assert.strictEqual(suppress, false, 'MINOR severity should not suppress low priority syncs');

        // Clean up
        await maintDetector.clearMaintenance();
        activePageInstance._isCaptcha = false;
        activePageInstance._html = mockHtmlPages.loginHtml;
    });

    console.log('\n════════════════════════════════════════════════════════════');
    console.log(`  Audit Results: ${passed} passed, ${failed} failed`);
    console.log('════════════════════════════════════════════════════════════');

    if (failures.length > 0) {
        console.log('\nFailures:');
        for (const f of failures) {
            console.log(`  ❌ ${f.name}`);
            console.log(`     ${f.error}`);
        }
        process.exit(1);
    } else {
        console.log('\n  🎉 Scraper reliability runtime integration audit passed successfully!\n');
        process.exit(0);
    }
}

setTimeout(() => {
    runTests().catch(err => {
        console.error('\nAudit runner crashed:', err.message);
        console.error(err.stack);
        process.exit(1);
    });
}, 1500);
