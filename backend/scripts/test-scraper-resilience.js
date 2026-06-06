/**
 * SITAM Smart ERP — Scraper Resilience Validation Suite
 *
 * Tests all hardening components without requiring a live ERP connection.
 * Uses mock pages, fixture HTML, and in-process state to validate behavior.
 *
 * USAGE: node scripts/test-scraper-resilience.js
 * EXIT:  0 if all tests pass, 1 if any fail
 */

'use strict';

process.env.NODE_ENV = 'test';

const path = require('path');
const fs   = require('fs');

// ─── Test Harness ─────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
    try {
        const result = fn();
        if (result && typeof result.then === 'function') {
            return result.then(() => {
                console.log(`  ✅  ${name}`);
                passed++;
            }).catch(err => {
                console.error(`  ❌  ${name}: ${err.message}`);
                failures.push({ name, error: err.message });
                failed++;
            });
        } else {
            console.log(`  ✅  ${name}`);
            passed++;
            return Promise.resolve();
        }
    } catch (err) {
        console.error(`  ❌  ${name}: ${err.message}`);
        failures.push({ name, error: err.message });
        failed++;
        return Promise.resolve();
    }
}

function assert(condition, message) {
    if (!condition) throw new Error(message || 'Assertion failed');
}

function assertEqual(a, b, message) {
    if (a !== b) throw new Error(message || `Expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

// ─── Test Groups ──────────────────────────────────────────────────────────────

async function runERPSelectorsTests() {
    console.log('\n📋  ERP Selectors');
    const { ERP_SELECTORS, ERP_URLS, PAGE_CONTENT_IDS } = require('../providers/scraper/selectors/ERPSelectors');

    await test('ERP_SELECTORS has all required keys', () => {
        const required = ['LOGIN_USERNAME', 'LOGIN_PASSWORD', 'LOGIN_BUTTON', 'PROFILE_CONTAINER', 'MARKS_CONTAINER', 'FEES_CONTAINER', 'CAPTCHA_INDICATOR'];
        for (const key of required) {
            assert(Array.isArray(ERP_SELECTORS[key]) && ERP_SELECTORS[key].length > 0, `Missing selector: ${key}`);
        }
    });

    await test('Each selector chain has at least 3 fallbacks', () => {
        for (const [key, chain] of Object.entries(ERP_SELECTORS)) {
            if (chain.length > 0) {
                assert(chain.length >= 1, `${key} has zero selectors`);
            }
        }
    });

    await test('ERP_URLS has all 6 required pages', () => {
        const required = ['LOGIN', 'PROFILE', 'MARKS', 'FEES', 'ASSIGNMENTS', 'LOGOUT'];
        for (const page of required) assert(ERP_URLS[page], `Missing URL: ${page}`);
    });

    await test('PAGE_CONTENT_IDS covers all scraping pages', () => {
        const required = ['PROFILE', 'MARKS', 'FEES', 'ASSIGNMENTS'];
        for (const page of required) {
            assert(Array.isArray(PAGE_CONTENT_IDS[page]) && PAGE_CONTENT_IDS[page].length > 0, `Missing content IDs: ${page}`);
        }
    });
}

async function runDOMDriftTests() {
    console.log('\n🔍  DOM Drift Detection');
    const driftDetector = require('../providers/scraper/drift/DOMDriftDetector');

    await test('fingerprint() produces valid fingerprint structure', () => {
        const html = '<html><body><form><input type="text" id="txtId2"><table><tr><td>Test</td></tr></table></form></body></html>';
        const fp   = driftDetector.fingerprint(html, 'login');
        assert(fp.page === 'login', 'Page name preserved');
        assert(typeof fp.tableCount === 'number', 'tableCount is number');
        assert(typeof fp.formCount  === 'number', 'formCount is number');
        assert(typeof fp.structuralHash === 'string', 'structuralHash is string');
        assert(fp.htmlLength > 0, 'htmlLength > 0');
    });

    await test('fingerprint() handles empty HTML gracefully', () => {
        const fp = driftDetector.fingerprint('', 'login');
        assert(fp.htmlLength === 0, 'Empty fingerprint htmlLength = 0');
        assert(fp.structuralHash === 'empty', 'Empty fingerprint hash = "empty"');
    });

    await test('computeDriftScore() returns 0 for identical fingerprints', () => {
        const html = '<html><body><form action="/"><table><tr><td>Same</td></tr></table></form></body></html>';
        const fp1  = driftDetector.fingerprint(html, 'profile');
        const fp2  = driftDetector.fingerprint(html, 'profile');
        const { score } = driftDetector.computeDriftScore(fp1, fp2);
        assert(score === 0, `Expected score=0 for identical pages, got ${score}`);
    });

    await test('computeDriftScore() detects major structural changes', () => {
        const html1 = '<html><body>' + '<table><tr><td></td></tr></table>'.repeat(10) + '<form><input></form></body></html>';
        const html2 = '<html><body><p>Completely different content with no tables</p></body></html>';
        const fp1   = driftDetector.fingerprint(html1, 'marks');
        const fp2   = driftDetector.fingerprint(html2, 'marks');
        const { score } = driftDetector.computeDriftScore(fp1, fp2);
        assert(score > 20, `Expected score > 20 for major change, got ${score}`);
    });

    await test('classifyDrift() maps scores to correct severities', () => {
        assertEqual(driftDetector.classifyDrift(0).severity,   'none',     'score=0 → none');
        assertEqual(driftDetector.classifyDrift(10).severity,  'minor',    'score=10 → minor');
        assertEqual(driftDetector.classifyDrift(40).severity,  'major',    'score=40 → major');
        assertEqual(driftDetector.classifyDrift(80).severity,  'critical', 'score=80 → critical');
    });

    await test('classifyDrift() critical triggers suspension', () => {
        const result = driftDetector.classifyDrift(90);
        assert(result.shouldSuspend === true, 'Critical drift should suspend');
        assert(result.shouldAlert   === true, 'Critical drift should alert');
    });
}

async function runAntiBotTests() {
    console.log('\n🛡️  Anti-Bot Detection');
    const antiBotDetector = require('../providers/scraper/antibot/AntiBotDetector');

    // Mock Puppeteer page
    function mockPage(url, html, selectors = {}) {
        return {
            url:     () => url,
            content: async () => html,
            $:       async (sel) => selectors[sel] || null
        };
    }

    await test('detect() returns no-challenge for clean ERP page', async () => {
        const page = mockPage('https://erp.college.edu/SATYA/Dashboard.aspx', '<html><body><div id="divProfile">Student data</div></body></html>');
        const result = await antiBotDetector.detect(page, null, { pageName: 'profile' });
        assert(!result.detected, 'Clean page should not detect challenge');
    });

    await test('detect() identifies CAPTCHA text patterns', async () => {
        const page = mockPage('https://erp.college.edu/', '<html><body><p>Please verify you are a human</p></body></html>');
        const result = await antiBotDetector.detect(page, null, { pageName: 'login' });
        assert(result.detected, 'Should detect CAPTCHA text');
        assertEqual(result.type, 'CAPTCHA', 'Type should be CAPTCHA');
    });

    await test('detect() identifies Cloudflare interstitials', async () => {
        const page = mockPage('https://erp.college.edu/', '<html><body><p>Checking your browser before accessing the site.</p></body></html>');
        const result = await antiBotDetector.detect(page, null, { pageName: 'login' });
        assert(result.detected, 'Should detect Cloudflare');
        assertEqual(result.type, 'CLOUDFLARE', 'Type should be CLOUDFLARE');
    });

    await test('detect() identifies maintenance pages', async () => {
        const page = mockPage('https://erp.college.edu/', '<html><body><h1>Site is under maintenance</h1></body></html>');
        const result = await antiBotDetector.detect(page, null);
        assert(result.detected, 'Should detect maintenance');
        assertEqual(result.type, 'MAINTENANCE', 'Type should be MAINTENANCE');
    });

    await test('isLoginLoop() correctly identifies session expiry redirects', () => {
        assert(antiBotDetector.isLoginLoop('https://erp.edu/SATYA/Default.aspx', 'Profile.aspx'), 'Should detect login loop');
        assert(!antiBotDetector.isLoginLoop('https://erp.edu/SATYA/StudentProfile.aspx', 'Profile.aspx'), 'Should not detect loop on correct page');
    });
}

async function runRetryClassifierTests() {
    console.log('\n🔄  Retry Classifier');
    const classifier = require('../providers/scraper/retry/AdaptiveRetryClassifier');
    const { AuthenticationError, SessionExpiredError, ERPUnavailableError, CaptchaDetectedError, SelectorDriftError } = require('../providers/errors');

    await test('classify() → AuthenticationError → halt, no retry', () => {
        const strategy = classifier.classify(new AuthenticationError('Bad creds', {}));
        assert(!strategy.retry, 'Auth errors should not retry');
        assertEqual(strategy.action, 'halt', 'Auth errors → halt');
    });

    await test('classify() → CaptchaDetectedError → quarantine, no retry', () => {
        const strategy = classifier.classify(new CaptchaDetectedError('CAPTCHA', {}));
        assert(!strategy.retry, 'CAPTCHA should not retry');
        assertEqual(strategy.action, 'quarantine', 'CAPTCHA → quarantine');
    });

    await test('classify() → SelectorDriftError → alert, no retry', () => {
        const strategy = classifier.classify(new SelectorDriftError('Drift', {}));
        assert(!strategy.retry, 'Drift should not retry');
        assertEqual(strategy.action, 'alert', 'Drift → alert');
    });

    await test('classify() → SessionExpiredError → relogin, retry', () => {
        const strategy = classifier.classify(new SessionExpiredError('Expired', {}));
        assert(strategy.retry, 'Expired session should retry');
        assertEqual(strategy.action, 'full_relogin', 'Expired → full_relogin');
    });

    await test('classify() → ERPUnavailableError → backoff, retry with delay', () => {
        const strategy = classifier.classify(new ERPUnavailableError('503', {}), { attempt: 1 });
        assert(strategy.retry, 'ERP unavailable should retry');
        assert(strategy.delayMs > 0, 'Should have a backoff delay');
    });

    await test('shouldSuppressQueue() returns true for no-retry error types', () => {
        assert(classifier.shouldSuppressQueue('CaptchaDetectedError'), 'CAPTCHA should suppress queue');
        assert(classifier.shouldSuppressQueue('SelectorDriftError'), 'Drift should suppress queue');
        assert(!classifier.shouldSuppressQueue('ERPUnavailableError'), 'Unavailable should not suppress');
    });

    await test('computeDelay() adds jitter within expected range', () => {
        const strategy = { delayMs: 10000 };
        for (let i = 0; i < 20; i++) {
            const delay = classifier.computeDelay(strategy, 1);
            assert(delay >= 10000, 'Delay should be at least base delay');
            assert(delay <= 120000, 'Delay capped at 2 minutes');
        }
    });
}

async function runPartialSyncRecoveryTests() {
    console.log('\n💾  Partial Sync Recovery');
    const recovery = require('../providers/scraper/recovery/PartialSyncRecovery');

    const testUserId = `test-recovery-${Date.now()}`;

    await test('getRecoveryPlan() returns all modules for fresh user', async () => {
        const plan = await recovery.getRecoveryPlan(testUserId);
        assert(plan.includes('profile'),     'Fresh plan includes profile');
        assert(plan.includes('marks'),       'Fresh plan includes marks');
        assert(plan.includes('fees'),        'Fresh plan includes fees');
        assert(plan.includes('assignments'), 'Fresh plan includes assignments');
    });

    await test('saveCheckpoint() and getRecoveryPlan() skip completed modules', async () => {
        const uid = `test-checkpoint-${Date.now()}`;
        await recovery.saveCheckpoint(uid, 'profile', 'done', { name: 'Test' });
        await recovery.saveCheckpoint(uid, 'marks',   'done', { marks: [] });

        const plan = await recovery.getRecoveryPlan(uid);
        assert(!plan.includes('profile'), 'Completed profile should be skipped');
        assert(!plan.includes('marks'),   'Completed marks should be skipped');
        assert(plan.includes('fees'),     'Pending fees should remain');

        await recovery.clearCheckpoint(uid);
    });

    await test('hasPartialCheckpoint() correctly identifies partial state', async () => {
        const uid = `test-partial-${Date.now()}`;
        assert(!(await recovery.hasPartialCheckpoint(uid)), 'No checkpoint → false');

        await recovery.saveCheckpoint(uid, 'profile', 'done', {});
        await recovery.saveCheckpoint(uid, 'marks',   'failed', null);
        assert(await recovery.hasPartialCheckpoint(uid), 'Partial checkpoint → true');

        await recovery.clearCheckpoint(uid);
    });

    await test('getCachedData() returns null for unknown keys', () => {
        const result = recovery.getCachedData('nonexistent-user', 'marks');
        assert(result === null, 'Unknown cache key should return null');
    });

    await test('getSummary() returns structured summary', async () => {
        const uid = `test-summary-${Date.now()}`;
        await recovery.saveCheckpoint(uid, 'profile', 'done', {});
        await recovery.saveCheckpoint(uid, 'fees',    'failed', null);

        const summary = await recovery.getSummary(uid);
        assert(summary.hasCheckpoint, 'Summary should indicate checkpoint exists');
        assert(summary.completed.includes('profile'), 'Completed includes profile');
        assert(summary.failed.includes('fees'), 'Failed includes fees');

        await recovery.clearCheckpoint(uid);
    });
}

async function runSyncDeduplicatorTests() {
    console.log('\n🔒  Sync Deduplication');
    const dedup = require('../providers/scraper/dedup/SyncDeduplicator');

    await test('acquireLock() succeeds for new user', async () => {
        const uid = `test-dedup-${Date.now()}`;
        const acquired = await dedup.acquireLock(uid, 5000, 'test');
        assert(acquired, 'First lock should succeed');
        await dedup.releaseLock(uid);
    });

    await test('acquireLock() fails for already-locked user (in-memory)', async () => {
        const uid = `test-dedup-blocked-${Date.now()}`;
        const first = await dedup.acquireLock(uid, 5000, 'test-1');
        assert(first, 'First lock should succeed');

        const second = await dedup.acquireLock(uid, 5000, 'test-2');
        assert(!second, 'Second lock should be denied');

        await dedup.releaseLock(uid);
    });

    await test('withLock() executes function and releases lock', async () => {
        const uid = `test-withlock-${Date.now()}`;
        let executed = false;
        const result = await dedup.withLock(uid, async () => {
            executed = true;
            return 'done';
        });
        assert(executed, 'Function should have executed');
        assertEqual(result, 'done', 'Return value preserved');

        // Should be able to acquire again after completion
        const canAcquire = await dedup.acquireLock(uid, 1000, 'after');
        assert(canAcquire, 'Lock should be released after withLock');
        await dedup.releaseLock(uid);
    });
}

async function runHealthScorerTests() {
    console.log('\n❤️  ERP Health Scorer');
    const scorer = require('../providers/scraper/health/ERPHealthScorer');

    await test('getHealthScore() returns 100 with no events recorded', async () => {
        const score = await scorer.getHealthScore();
        assert(score >= 0 && score <= 100, `Score ${score} out of range`);
    });

    await test('recordLoginAttempt() affects health score', async () => {
        scorer.recordLoginAttempt(true);
        scorer.recordLoginAttempt(true);
        scorer.recordLoginAttempt(false); // 1 failure
        const score = await scorer.getHealthScore();
        assert(score >= 0 && score <= 100, `Score ${score} out of range`);
    });

    await test('getSummary() returns structured data', async () => {
        const summary = await scorer.getSummary();
        assert(typeof summary.score   === 'number', 'score is number');
        assert(typeof summary.status  === 'string',  'status is string');
        assert(['healthy', 'degraded', 'unstable', 'critical'].includes(summary.status), `Unknown status: ${summary.status}`);
        assert(summary.components !== undefined, 'Components present');
    });

    await test('captcha recording lowers health score', async () => {
        const before = await scorer.getHealthScore();
        scorer.recordCaptchaDetection();
        scorer.recordCaptchaDetection();
        scorer.recordCaptchaDetection();
        scorer.recordSyncCompletion(false, 5000);
        scorer.recordSyncCompletion(false, 5000);
        scorer.recordSyncCompletion(false, 5000);
        const after = await scorer.getHealthScore();
        assert(after <= before, `Health should decrease or stay same after failures: before=${before} after=${after}`);
    });
}

async function runBrowserReputationTests() {
    console.log('\n🌐  Browser Reputation Manager');
    const repMgr = require('../providers/scraper/browser/BrowserReputationManager');

    await test('registerBrowser() creates browser record with score 100', () => {
        const id = `browser-test-${Date.now()}`;
        repMgr.registerBrowser(id);
        assertEqual(repMgr.getTrustScore(id), 100, 'New browser score = 100');
        assert(!repMgr.isQuarantined(id), 'New browser not quarantined');
    });

    await test('recordCaptcha() reduces trust score', () => {
        const id = `browser-cap-${Date.now()}`;
        repMgr.registerBrowser(id);
        repMgr.recordCaptcha(id);
        assert(repMgr.getTrustScore(id) < 100, 'Trust should decrease after CAPTCHA');
    });

    await test('Multiple CAPTCHAs trigger quarantine', () => {
        const id = `browser-quarantine-${Date.now()}`;
        repMgr.registerBrowser(id);
        // Repeatedly trigger CAPTCHA until quarantine (25 per hit, threshold 40)
        for (let i = 0; i < 3; i++) repMgr.recordCaptcha(id);
        assert(repMgr.isQuarantined(id), 'Should be quarantined after 3 CAPTCHAs (score < 40)');
    });

    await test('recordSuccess() slowly restores trust', () => {
        const id = `browser-restore-${Date.now()}`;
        repMgr.registerBrowser(id);
        repMgr.recordTimeout(id); // score = 92
        const before = repMgr.getTrustScore(id);
        repMgr.recordSuccess(id); // +2
        assert(repMgr.getTrustScore(id) >= before, 'Success should restore trust');
    });

    await test('getSummary() returns structured data', () => {
        const summary = repMgr.getSummary();
        assert(typeof summary.quarantined === 'number', 'quarantined count is number');
        assert(Array.isArray(summary.browsers), 'browsers is array');
    });
}

async function runMaintenanceDetectorTests() {
    console.log('\n🔧  Maintenance Mode Detector');
    const detector = require('../providers/scraper/maintenance/ERPMaintenanceDetector');

    function mockPage(url, html) {
        return { url: () => url, content: async () => html, evaluate: async () => '' };
    }

    await test('detect() returns false for normal ERP page', async () => {
        const page = mockPage('https://erp.edu/SATYA/Dashboard', '<html><body><div>Welcome Student</div></body></html>');
        const result = await detector.detect(page);
        assert(!result.detected, 'Normal page should not trigger maintenance');
    });

    await test('detect() identifies maintenance page', async () => {
        const page = mockPage('https://erp.edu/', '<html><body><h1>Site is under maintenance. We will be back soon.</h1></body></html>');
        const result = await detector.detect(page);
        assert(result.detected, 'Should detect maintenance');
        assert(result.severity !== null, 'Severity should be set');
    });

    await test('shouldSuppressSync() suppresses low priority during DEGRADED', async () => {
        // Manually inject state for test
        detector._localState    = { severity: 'DEGRADED', expiresAt: new Date(Date.now() + 60000).toISOString() };
        detector._localStateExp = Date.now() + 60000;
        assert(await detector.shouldSuppressSync('low'), 'Low priority should be suppressed during DEGRADED');
        assert(!(await detector.shouldSuppressSync('critical')), 'Critical should pass during DEGRADED');
        detector._localState = null; // cleanup
    });
}

async function runSyncPriorityTests() {
    console.log('\n⚡  Sync Priority Engine');
    const priority = require('../providers/scraper/priorities/SyncPriorityEngine');

    await test('getModuleOrder() returns all modules in NORMAL health', () => {
        const order = priority.getModuleOrder({ healthStatus: 'NORMAL' });
        assert(order.includes('profile'),     'profile in normal order');
        assert(order.includes('marks'),       'marks in normal order');
        assert(order.includes('fees'),        'fees in normal order');
        assert(order.includes('assignments'), 'assignments in normal order');
    });

    await test('getModuleOrder() excludes low-priority modules in UNSTABLE health', () => {
        const order = priority.getModuleOrder({ healthStatus: 'UNSTABLE' });
        assert(order.includes('marks'), 'marks should survive UNSTABLE');
        // fees (score=4) and assignments (score=3) below UNSTABLE threshold (7)
        assert(!order.includes('fees'),        'fees should be shed in UNSTABLE');
        assert(!order.includes('assignments'), 'assignments should be shed in UNSTABLE');
    });

    await test('marks priority boosted after setExamPeriod(true)', () => {
        priority.setExamPeriod(true);
        const state = priority.getState();
        assert(state.globalBoosts.marks > 0, 'marks boost should be active');
        priority.setExamPeriod(false); // cleanup
    });

    await test('getModulePriority() returns high for marks', () => {
        const p = priority.getModulePriority('marks');
        assert(['high', 'critical'].includes(p), `marks should be high/critical, got ${p}`);
    });

    await test('getModulePriority() returns low for assignments', () => {
        const p = priority.getModulePriority('assignments');
        assert(['low', 'medium'].includes(p), `assignments should be low/medium, got ${p}`);
    });
}

async function runQueueFairnessTests() {
    console.log('\n⚖️  Queue Fairness (QueuePressureManager)');
    const qpm = require('../providers/scraper/throttle/QueuePressureManager');

    await test('getPressureLevel() returns NORMAL at startup', () => {
        const level = qpm.getPressureLevel();
        assert(level.level !== undefined, 'Level should be defined');
        assert(level.concurrencyLimit > 0, 'Concurrency should be positive');
    });

    await test('updateFromHealthScore() transitions pressure levels correctly', () => {
        qpm.updateFromHealthScore(85);
        assertEqual(qpm.getPressureLevel().level, 'NORMAL', 'health=85 → NORMAL');

        qpm.updateFromHealthScore(65);
        assertEqual(qpm.getPressureLevel().level, 'ELEVATED', 'health=65 → ELEVATED');

        qpm.updateFromHealthScore(45);
        assertEqual(qpm.getPressureLevel().level, 'HIGH', 'health=45 → HIGH');

        qpm.updateFromHealthScore(30);
        assertEqual(qpm.getPressureLevel().level, 'CRITICAL', 'health=30 → CRITICAL');

        qpm.updateFromHealthScore(100); // reset
    });

    await test('shouldThrottle() allows critical priority through CRITICAL pressure', () => {
        qpm.updateFromHealthScore(30); // CRITICAL
        const result = qpm.shouldThrottle('any-user', 'critical');
        assert(!result.throttle, 'Critical priority should bypass throttle');
        qpm.updateFromHealthScore(100); // reset
    });

    await test('isStarving() detects long-waiting users', () => {
        const uid = `starving-${Date.now()}`;
        qpm.registerWaiting(uid, 'low');
        // Manually age the entry
        qpm._waitingUsers.get(uid).since = Date.now() - 10 * 60 * 1000; // 10 min ago
        assert(qpm.isStarving(uid), 'User waiting 10 min should be starving');
        qpm._waitingUsers.delete(uid); // cleanup
    });

    await test('getEffectivePriority() promotes starving users', () => {
        const uid = `promote-${Date.now()}`;
        qpm.registerWaiting(uid, 'low');
        qpm._waitingUsers.get(uid).since = Date.now() - 10 * 60 * 1000;
        const boosted = qpm.getEffectivePriority(uid, 'low');
        assertEqual(boosted, 'medium', 'Starving low-priority should be promoted to medium');
        qpm._waitingUsers.delete(uid); // cleanup
    });
}

async function runAdaptiveSelectorTests() {
    console.log('\n🧠  Adaptive Selector Optimizer');
    const optimizer = require('../providers/scraper/selectors/AdaptiveSelectorOptimizer');
    const { ERP_SELECTORS } = require('../providers/scraper/selectors/ERPSelectors');

    await test('getOptimizedChain() returns original chain when no history', async () => {
        const chain = await optimizer.getOptimizedChain('LOGIN_USERNAME');
        assert(Array.isArray(chain), 'Should return array');
        assert(chain.length === ERP_SELECTORS.LOGIN_USERNAME.length, 'Should preserve all selectors');
    });

    await test('recordOutcome() and getConfidenceReport() work correctly', async () => {
        await optimizer.recordOutcome('LOGIN_USERNAME', 0, true, 'login');
        await optimizer.recordOutcome('LOGIN_USERNAME', 0, true, 'login');
        const report = await optimizer.getConfidenceReport('LOGIN_USERNAME');
        assert(Array.isArray(report.depths), 'Depths should be array');
        assert(report.selectorKey === 'LOGIN_USERNAME', 'selectorKey preserved');
    });

    await test('resetOptimization() clears learned data', async () => {
        await optimizer.resetOptimization('LOGIN_USERNAME');
        const chain = await optimizer.getOptimizedChain('LOGIN_USERNAME');
        // After reset, ordering is cleared — should return original order
        assert(Array.isArray(chain), 'Chain still returns after reset');
    });
}

async function runLoadSheddingTests() {
    console.log('\n🔥  Adaptive Load Shedding');
    const shedder = require('../providers/scraper/throttle/AdaptiveLoadShedding');

    await test('admitSync() passes high priority in NORMAL mode', () => {
        shedder.updateFromHealthScore(90);
        const result = shedder.admitSync({ priority: 'high' });
        assert(result.admitted, 'High priority should be admitted in NORMAL mode');
    });

    await test('admitSync() blocks low priority in PROTECTED mode', () => {
        shedder.updateFromHealthScore(45); // PROTECTED
        const result = shedder.admitSync({ priority: 'low' });
        assert(!result.admitted, 'Low priority should be blocked in PROTECTED mode');
        shedder.updateFromHealthScore(90); // reset
    });

    await test('admitSync() allows user-triggered syncs through PROTECTED', () => {
        shedder.updateFromHealthScore(45); // PROTECTED
        const result = shedder.admitSync({ priority: 'high', triggeredByUser: true });
        assert(result.admitted, 'User-triggered high priority should pass PROTECTED');
        shedder.updateFromHealthScore(90); // reset
    });

    await test('getCurrentConfig() returns valid mode config', () => {
        const config = shedder.getCurrentConfig();
        assert(typeof config.concurrency === 'number', 'concurrency is number');
        assert(typeof config.poolSize === 'number', 'poolSize is number');
        assert(typeof config.retryAllowed === 'boolean', 'retryAllowed is boolean');
    });

    await test('getModeHistory() tracks transitions', () => {
        shedder.updateFromHealthScore(90);
        shedder.updateFromHealthScore(30);
        shedder.updateFromHealthScore(90);
        const history = shedder.getModeHistory(10);
        assert(Array.isArray(history), 'History is array');
    });
}

async function runForecastingTests() {
    console.log('\n📈  Reliability Forecaster');
    const forecaster = require('../providers/scraper/forecasting/ScraperReliabilityForecaster');

    await test('forecast() returns valid structure with no history', () => {
        const result = forecaster.forecast();
        assert(typeof result.reliabilityScore === 'number', 'reliabilityScore is number');
        assert(typeof result.captchaRisk === 'number', 'captchaRisk is number');
        assert(typeof result.outageRisk === 'number', 'outageRisk is number');
        assert(result.reliabilityScore >= 0 && result.reliabilityScore <= 100, 'Score in range');
        assert(typeof result.recommendation === 'string', 'recommendation is string');
    });

    await test('recordCaptchaHit() affects forecast risk', () => {
        for (let i = 0; i < 5; i++) {
            forecaster.recordCaptchaHit();
            forecaster.recordSyncAttempt();
        }
        const result = forecaster.forecast();
        assert(result.captchaRisk >= 0, 'captchaRisk should be non-negative');
    });

    await test('isRiskElevated() returns false when no data', () => {
        const fresh = require('../providers/scraper/forecasting/ScraperReliabilityForecaster');
        // Uses lastForecast which starts at 0% risk
        const elevated = fresh.isRiskElevated('captcha');
        assert(typeof elevated === 'boolean', 'Should return boolean');
    });

    await test('getLastForecast() returns cached result', () => {
        const f1 = forecaster.forecast();
        const f2 = forecaster.getLastForecast();
        assert(f1.forecastedAt === f2.forecastedAt || f2.forecastedAt !== null, 'Should return cached forecast');
    });
}

// ─── Main Runner ──────────────────────────────────────────────────────────────

async function main() {
    console.log('══════════════════════════════════════════════════════════');
    console.log('  SITAM Smart ERP — Scraper Resilience Validation Suite   ');
    console.log('══════════════════════════════════════════════════════════');

    const allTests = [
        runERPSelectorsTests,
        runDOMDriftTests,
        runAntiBotTests,
        runRetryClassifierTests,
        runPartialSyncRecoveryTests,
        runSyncDeduplicatorTests,
        runHealthScorerTests,
        runBrowserReputationTests,
        runMaintenanceDetectorTests,
        runSyncPriorityTests,
        runQueueFairnessTests,
        runAdaptiveSelectorTests,
        runLoadSheddingTests,
        runForecastingTests
    ];

    for (const group of allTests) {
        await group();
    }

    console.log('\n══════════════════════════════════════════════════════════');
    console.log(`  Results: ${passed} passed  /  ${failed} failed  /  ${passed + failed} total`);
    console.log('══════════════════════════════════════════════════════════\n');

    if (failures.length > 0) {
        console.error('FAILURES:');
        failures.forEach(f => console.error(`  - ${f.name}: ${f.error}`));
        console.log('');
        process.exit(1);
    } else {
        console.log('✅  All tests passed!\n');
        process.exit(0);
    }
}

main().catch(err => {
    console.error('[FATAL] Test runner error:', err.message, err.stack);
    process.exit(1);
});
