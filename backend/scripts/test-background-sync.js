/**
 * Background Sync — Scraper Pipeline Regression Tests
 *
 * Verifies that SITAMScraperProvider.syncStudent() correctly:
 *   A. Calls this.login() for auth-only
 *   B. Calls erpBrowserService.loginWithCookies() with the auth cookies
 *   C. Populates profileHtml from the cookie-based scrape
 *   D. Populates marksHtml from the cookie-based scrape
 *   E. Populates feesHtml from the cookie-based scrape
 *   F. Populates assignmentsHtml from the cookie-based scrape
 *   G. Passes non-empty HTML to parsers
 *   H. Returns a SyncResult with real scraped values
 *   I. Missing HTML does NOT silently overwrite real fields with dummy defaults
 *
 * Run: node scripts/test-background-sync.js
 */
'use strict';

process.env.NODE_ENV     = 'test';
process.env.DEMO_MODE    = 'false';
process.env.ERP_PROVIDER = 'scraper';
process.env.ERP_BASE_URL = 'https://sitamecap.co.in';

const assert = require('assert');

// ── Tracking helpers ──────────────────────────────────────────────────────────
let loginWithCookiesCalls   = [];
let loginCalls              = [];
let parseProfileCalled      = false;
let parseMarksCalled        = false;
let parseFeesCalled         = false;
let parseAssignmentsCalled  = false;
let profileHtmlSentToParser = '';
let marksHtmlSentToParser   = '';
let feesHtmlSentToParser    = '';
let assignmentsHtmlSentToParser = '';

function resetTrackers() {
    loginWithCookiesCalls   = [];
    loginCalls              = [];
    parseProfileCalled      = false;
    parseMarksCalled        = false;
    parseFeesCalled         = false;
    parseAssignmentsCalled  = false;
    profileHtmlSentToParser = '';
    marksHtmlSentToParser   = '';
    feesHtmlSentToParser    = '';
    assignmentsHtmlSentToParser = '';
}

// ── HTML fixtures — minimal realistic ERP snippets ────────────────────────────
const FIXTURE_PROFILE_HTML = `<table><tr><td>Name</td><td>:</td><td>ATTADA BHAGYA LAKSHMI</td></tr>
<tr><td>RollNo</td><td>:</td><td>22B61A0501</td></tr>
<tr><td>Branch</td><td>:</td><td>Computer Science</td></tr></table>`;

const FIXTURE_MARKS_HTML = `<table><tr><td>CS-401</td><td>Data Structures</td><td>A+</td><td>4.0</td></tr>
<tr><td>CS-402</td><td>Operating Systems</td><td>A</td><td>4.0</td></tr></table>`;

const FIXTURE_FEES_HTML = `<table><tr><td>Tuition Fee</td><td>85000</td><td>Paid</td></tr>
<tr><td>Development Fee</td><td>15000</td><td>Due</td></tr></table>`;

const FIXTURE_ASSIGNMENTS_HTML = `<table><tr><td>B-Tree Implementation</td><td>CS-401</td><td>Submitted</td></tr>
<tr><td>Process Scheduling</td><td>CS-402</td><td>Pending</td></tr></table>`;

// ── Mock: erpBrowserService ───────────────────────────────────────────────────
const mockErpBrowserService = {
    _loginWithCookiesImpl: async (userId, cookieString) => {
        loginWithCookiesCalls.push({ userId, cookieString });
        if (!cookieString || !cookieString.includes('ASP.NET_SessionId'))
            throw new Error('loginWithCookies called with invalid/empty cookies');
        return {
            scrapedData: {
                studentName: 'ATTADA BHAGYA LAKSHMI',
                profileHtml: FIXTURE_PROFILE_HTML,
                marksHtml:   FIXTURE_MARKS_HTML,
                feesHtml:    FIXTURE_FEES_HTML,
                assignmentsHtml: FIXTURE_ASSIGNMENTS_HTML
            },
            perfReport: { totalMs: 30000 }
        };
    },
    login: async (userId, password, requestId) => {
        loginCalls.push({ userId, password, requestId });
        if (password === 'wrong') throw new Error('Login failed — still on login page. Check credentials.');
        return {
            cookieString: 'ASP.NET_SessionId=real-session-abc; frmAuth=real-auth-xyz',
            scrapedData:  { studentName: 'ATTADA BHAGYA LAKSHMI' },
            perfReport:   { totalMs: 8000 },
            requestId:    requestId || 'req-test-001'
        };
    },
    loginWithCookies: async (userId, cookieString, requestId) => {
        return mockErpBrowserService._loginWithCookiesImpl(userId, cookieString);
    }
};
require.cache[require.resolve('../services/erpBrowserService')] = { exports: mockErpBrowserService };

// ── Mock: ERPScraper — intercept parser calls to record input HTML ─────────────
const erpScraperMod = require('../services/erpScraper');
const RealParseProfile    = erpScraperMod.ERPScraper.parseProfile.bind(erpScraperMod.ERPScraper);
const RealParseMarks      = erpScraperMod.ERPScraper.parseMarks.bind(erpScraperMod.ERPScraper);
const RealParseFees       = erpScraperMod.ERPScraper.parseFees.bind(erpScraperMod.ERPScraper);
const RealParseAssignments = erpScraperMod.ERPScraper.parseAssignments.bind(erpScraperMod.ERPScraper);

erpScraperMod.ERPScraper.parseProfile = (data) => {
    parseProfileCalled = true;
    profileHtmlSentToParser = data.profileHtml || '';
    return RealParseProfile(data);
};
erpScraperMod.ERPScraper.parseMarks = (data) => {
    parseMarksCalled = true;
    marksHtmlSentToParser = data.marksHtml || '';
    return RealParseMarks(data);
};
erpScraperMod.ERPScraper.parseFees = (data) => {
    parseFeesCalled = true;
    feesHtmlSentToParser = data.feesHtml || '';
    return RealParseFees(data);
};
erpScraperMod.ERPScraper.parseAssignments = (data) => {
    parseAssignmentsCalled = true;
    assignmentsHtmlSentToParser = data.assignmentsHtml || '';
    return RealParseAssignments(data);
};

// ── Minimal stubs ─────────────────────────────────────────────────────────────
const mockLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
require.cache[require.resolve('../services/logger')] = { exports: mockLogger };
require.cache[require.resolve('../services/circuitBreaker')] = {
    exports: { execute: async (fn) => fn() }
};
require.cache[require.resolve('../providers/session/ProviderSessionManager')] = {
    exports: { store: async () => {}, acquire: async () => null, invalidate: async () => {} }
};
require.cache[require.resolve('../telemetry/tracing')] = {
    exports: { traceSpan: async (_n, _a, fn) => fn(null) }
};
require.cache[require.resolve('../providers/telemetry/ProviderMetrics')] = {
    exports: { recordOperation: () => {}, recordSyncSuccess: () => {}, recordSyncFailure: () => {},
               setHealthScore: () => {}, recordSessionRefresh: () => {}, recordDOMDrift: () => {},
               recordCaptchaDetection: () => {} }
};
require.cache[require.resolve('../providers/scraper/recovery/PartialSyncRecovery')] = {
    exports: { getRecoveryPlan: async () => ['profile','marks','fees','assignments'],
               getCachedData: () => null, saveCheckpoint: async () => {}, clearCheckpoint: async () => {} }
};
require.cache[require.resolve('../providers/scraper/drift/DOMDriftDetector')] = {
    exports: { fingerprint: () => ({}), _loadBaseline: async () => null,
               _saveBaseline: async () => {}, computeDriftScore: () => ({ score: 0, changes: [] }) }
};
require.cache[require.resolve('../providers/scraper/forecasting/ScraperReliabilityForecaster')] = {
    exports: { startPeriodicForecasting: () => {}, recordSyncAttempt: () => {},
               recordSyncFailure: () => {}, recordCaptchaHit: () => {} }
};
require.cache[require.resolve('../providers/scraper/health/ERPHealthScorer')] = {
    exports: { startPeriodicScoring: () => {}, getHealthScore: async () => 100,
               recordLoginAttempt: () => {}, recordSyncCompletion: () => {},
               recordCaptchaDetection: () => {} }
};
require.cache[require.resolve('../providers/scraper/throttle/QueuePressureManager')] = {
    exports: { updateFromHealthScore: () => {} }
};
require.cache[require.resolve('../providers/scraper/throttle/AdaptiveLoadShedding')] = {
    exports: { updateFromHealthScore: () => {} }
};
require.cache[require.resolve('../providers/scraper/antibot/AntiBotDetector')] = {
    exports: { assertNoBotChallenge: async () => {} }
};
require.cache[require.resolve('../providers/scraper/maintenance/ERPMaintenanceDetector')] = {
    exports: { isInMaintenanceWindow: async () => false, detect: async () => ({ detected: false }) }
};
require.cache[require.resolve('../providers/scraper/retry/AdaptiveRetryClassifier')] = {
    exports: { classify: () => ({ retry: false }) }
};
require.cache[require.resolve('../providers/scraper/selectors/AdaptiveSelectorOptimizer')] = {
    exports: { getOptimizedChain: async () => [], recordOutcome: async () => {} }
};

const provider = require('../providers/scraper/SITAMScraperProvider');

// ── Test runner ───────────────────────────────────────────────────────────────
let passed = 0, failed = 0;
async function test(label, fn) {
    try {
        await fn();
        console.log(`  \u2713 ${label}`);
        passed++;
    } catch (err) {
        console.error(`  \u2717 ${label}`);
        console.error(`    \u2192 ${err.message}`);
        failed++;
    }
}

async function main() {
    console.log('\n\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550');
    console.log(' Background Sync Scraper Pipeline Regression Tests');
    console.log('\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\n');

    console.log('[A] Authentication');
    await test('A. syncStudent() calls login() for authentication', async () => {
        resetTrackers();
        await provider.syncStudent('22B61A0501', 'realPassword');
        assert.ok(loginCalls.length >= 1, `Expected login() to be called, got ${loginCalls.length} calls`);
        assert.strictEqual(loginCalls[0].userId, '22B61A0501');
    });

    console.log('\n[B] Cookie handoff to cookie-based scraper');
    await test('B. Background sync calls loginWithCookies() with real auth cookies', async () => {
        resetTrackers();
        await provider.syncStudent('22B61A0501', 'realPassword');
        assert.ok(loginWithCookiesCalls.length >= 1,
            `loginWithCookies() must be called — got ${loginWithCookiesCalls.length} calls`);
        assert.ok(loginWithCookiesCalls[0].cookieString.includes('ASP.NET_SessionId'),
            `loginWithCookies() called with wrong cookies: "${loginWithCookiesCalls[0].cookieString}"`);
        assert.strictEqual(loginWithCookiesCalls[0].userId, '22B61A0501');
    });

    console.log('\n[C-F] HTML extraction per module');
    await test('C. profileHtml is fetched and passed non-empty to parseProfile()', async () => {
        resetTrackers();
        await provider.syncStudent('22B61A0501', 'realPassword');
        assert.ok(parseProfileCalled, 'parseProfile() was never called');
        assert.ok(profileHtmlSentToParser.length > 50,
            `profileHtml is empty. Got: "${profileHtmlSentToParser.substring(0,80)}"`);
        assert.ok(profileHtmlSentToParser.includes('ATTADA'), 'profileHtml must contain real student name');
    });

    await test('D. marksHtml is fetched and passed non-empty to parseMarks()', async () => {
        resetTrackers();
        await provider.syncStudent('22B61A0501', 'realPassword');
        assert.ok(parseMarksCalled, 'parseMarks() was never called');
        assert.ok(marksHtmlSentToParser.length > 50,
            `marksHtml is empty. Got: "${marksHtmlSentToParser.substring(0,80)}"`);
        assert.ok(marksHtmlSentToParser.includes('CS-401'), 'marksHtml must contain real subject codes');
    });

    await test('E. feesHtml is fetched and passed non-empty to parseFees()', async () => {
        resetTrackers();
        await provider.syncStudent('22B61A0501', 'realPassword');
        assert.ok(parseFeesCalled, 'parseFees() was never called');
        assert.ok(feesHtmlSentToParser.length > 50,
            `feesHtml is empty. Got: "${feesHtmlSentToParser.substring(0,80)}"`);
        assert.ok(feesHtmlSentToParser.includes('Tuition'), 'feesHtml must contain real fee titles');
    });

    await test('F. assignmentsHtml is fetched and passed non-empty to parseAssignments()', async () => {
        resetTrackers();
        await provider.syncStudent('22B61A0501', 'realPassword');
        assert.ok(parseAssignmentsCalled, 'parseAssignments() was never called');
        assert.ok(assignmentsHtmlSentToParser.length > 50,
            `assignmentsHtml is empty. Got: "${assignmentsHtmlSentToParser.substring(0,80)}"`);
        assert.ok(assignmentsHtmlSentToParser.includes('B-Tree'), 'assignmentsHtml must contain real titles');
    });

    console.log('\n[G-H] SyncResult values');
    await test('G. syncStudent() returns SyncResult with non-empty student name (not userId)', async () => {
        resetTrackers();
        const result = await provider.syncStudent('22B61A0501', 'realPassword');
        assert.ok(result && result.profile, 'SyncResult.profile is missing');
        assert.ok(result.profile.name && result.profile.name !== '',
            `profile.name must not be empty, got: "${result.profile.name}"`);
        assert.notStrictEqual(result.profile.name, '22B61A0501',
            'profile.name must not be the raw userId');
    });

    await test('H. parseProfile() was called (not skipped — HTML reached parser)', async () => {
        resetTrackers();
        await provider.syncStudent('22B61A0501', 'realPassword');
        assert.ok(parseProfileCalled, 'parseProfile was skipped — broken contract still in effect');
    });

    console.log('\n[I] Data integrity — no silent dummy/default fallbacks');
    await test('I. Empty HTML from failed scrape does NOT produce fake subject data', async () => {
        const origImpl = mockErpBrowserService._loginWithCookiesImpl;
        mockErpBrowserService._loginWithCookiesImpl = async () => ({
            scrapedData: {
                studentName: 'ATTADA BHAGYA LAKSHMI',
                profileHtml: '', marksHtml: '', feesHtml: '', assignmentsHtml: ''
            },
            perfReport: { totalMs: 5000 }
        });

        resetTrackers();
        let result;
        try {
            result = await provider.syncStudent('22B61A0501', 'realPassword');
        } finally {
            mockErpBrowserService._loginWithCookiesImpl = origImpl;
        }

        if (result && result.marks) {
            const subjectCount = result.marks.subjects?.length || 0;
            assert.strictEqual(subjectCount, 0,
                `With empty marksHtml, marks.subjects must be [] not ${subjectCount} fake subjects. ` +
                `Got: ${JSON.stringify(result.marks.subjects?.slice(0,2))}`);
            assert.notStrictEqual(result.marks.cgpa, '7.90', 'cgpa must not be the hardcoded dummy "7.90"');
            assert.notStrictEqual(result.marks.cgpa, '8.75', 'cgpa must not be the mock value "8.75"');
        }
    });

    console.log('\n\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550');
    console.log(` Results: ${passed} passed, ${failed} failed`);
    console.log('\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\n');
    if (failed > 0) process.exit(1);
}

main().catch(err => {
    console.error('FATAL:', err.message);
    process.exit(1);
});
