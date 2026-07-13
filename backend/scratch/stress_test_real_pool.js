/**
 * SITAM Smart ERP — Real BrowserPool Stress Tests & Timer Verification
 * ─────────────────────────────────────────────────────────────────────────────
 * Validates the actual implementation of BrowserPool and PerformanceTimer
 * under simulated high load and retry conditions without calling real Chromium.
 *
 * RUN: node scratch/stress_test_real_pool.js
 */
'use strict';

process.env.NODE_ENV = 'test';
process.env.BROWSER_ACQUIRE_TIMEOUT_MS = '15000';
process.env.BROWSER_MAX_JOBS = '1000';
process.env.LOG_LEVEL = 'warn';

const path = require('path');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ─── Patch BrowserInstance launch to use a lightweight mock browser ───────
const BrowserInstance = require('../services/browserPool/BrowserInstance');

let mockCallCount = 0;
let mockFailsRemaining = 0;
const MOCK_LAUNCH_DELAY = 10;

function createMockBrowser(id, listenerObj) {
    let _connected = true;
    const browser = {
        _id: id,
        process: () => ({ pid: 10000 + id, on: () => {} }),
        version: async () => `mock-${id}`,
        isConnected: () => _connected,
        createBrowserContext: async () => {
            if (!_connected) throw new Error('Target closed');
            return {
                _closed: false,
                _id: `ctx-${id}-${Date.now()}`,
                newPage: async () => ({
                    setUserAgent: async () => {},
                    setViewport: async () => {},
                    goto: async () => {},
                    close: async () => {},
                }),
                close: async function() { this._closed = true; },
                setCookie: async () => {},
            };
        },
        close: async () => { _connected = false; },
        on: (event, cb) => {
            if (event === 'disconnected') {
                listenerObj.onDisconnect = cb;
            }
        },
    };
    return browser;
}

BrowserInstance.prototype.launch = async function(_path) {
    const callId = ++mockCallCount;
    await sleep(MOCK_LAUNCH_DELAY);
    if (mockFailsRemaining > 0) {
        mockFailsRemaining--;
        throw new Error(`MockChromium FAILED (call #${callId})`);
    }
    
    this._mockListener = { onDisconnect: null };
    this.browser = createMockBrowser(callId, this._mockListener);
    this.pid = 10000 + callId;
    this.version = `mock-${callId}`;
    this.createdAt = Date.now();
    this.lastUsed = Date.now();
    this.healthy = true;
    
    const self = this;
    this.browser.on('disconnected', () => {
        if (self.retired) return;
        self.healthy = false;
        self.retired = true;
        try { self.onCrash(self); } catch(_) {}
    });
    return this;
};

// ─── Import real components ───────────────────────────────────────────────────
const browserPool = require('../services/browserPool'); // dual-pool index
const PerformanceTimer = require('../services/performanceTimer');
const { JOB_PRIORITY } = require('../services/browserPool/PriorityQueue');

// Override executable path finder to run instantly without searching FS
browserPool.authPool._executablePath = '/mock';
browserPool.syncPool._executablePath = '/mock';

function logState(pool, eventName) {
    const status = pool.getStatus();
    console.log(`[STATE] ${pool.name.padEnd(10)} - ${eventName.padEnd(20)} | live=${status.total} | active=${status.active} | idle=${status.idle} | launching=${status.launching} | queued=${status.queued}`);
}

async function runSuite() {
    console.log('\n======================================================================');
    console.log('  STARTING SITAM SMART ERP REAL BROWSERPOOL STRESS TESTS');
    console.log('======================================================================');

    // ────────────────────────────────────────────────────────────────────────
    // INITIALIZATION
    // ────────────────────────────────────────────────────────────────────────
    console.log('\n[INIT] Initializing browser pool (AUTH_POOL and SYNC_POOL)...');
    await browserPool.init();
    
    logState(browserPool.authPool, 'INIT COMPLETE');
    logState(browserPool.syncPool, 'INIT COMPLETE');

    // ────────────────────────────────────────────────────────────────────────
    // VERIFICATION 2 — timer.end('total') outside retry loop
    // ────────────────────────────────────────────────────────────────────────
    console.log('\n----------------------------------------------------------------------');
    console.log('  VERIFICATION 2 — timer.end("total") retry loop behavior');
    console.log('----------------------------------------------------------------------');

    // Simulates the scrape retry logic inside puppeteerService.js
    async function simulateScrapeWithRetries(requestId, userId, maxAttempts = 3, failUntilAttempt = 2) {
        const timer = new PerformanceTimer(requestId, userId);
        timer.start('total');
        let attempts = 0;

        console.log(`[TIMER] Starting scrape simulation with maxAttempts=${maxAttempts}`);
        
        while (attempts < maxAttempts) {
            attempts++;
            console.log(`[TIMER] Attempt ${attempts}: Starting navigation & scraping...`);
            timer.start(`attempt-${attempts}`);
            try {
                await sleep(50); // simulate network request latency
                if (attempts <= failUntilAttempt) {
                    throw new Error(`Navigation failed on attempt ${attempts}`);
                }
                timer.end(`attempt-${attempts}`);
                console.log(`[TIMER] Attempt ${attempts}: SUCCESS`);
                break; // exit loop
            } catch (err) {
                timer.end(`attempt-${attempts}`);
                console.log(`[TIMER] Attempt ${attempts}: FAILED — ${err.message}`);
                if (attempts >= maxAttempts) {
                    console.log(`[TIMER] No retries left. Propagation of error.`);
                    throw err;
                }
                console.log(`[TIMER] Retrying in 10ms...`);
                await sleep(10);
            }
        }

        timer.end('total');
        const report = timer.report();
        console.log('[TIMER] Performance Report:', JSON.stringify(report, null, 2));
        return report;
    }

    const timerReport = await simulateScrapeWithRetries('req-perf-test', 'student-perf-id');

    // ────────────────────────────────────────────────────────────────────────
    // STRESS TEST 1: Student A login
    // ────────────────────────────────────────────────────────────────────────
    console.log('\n----------------------------------------------------------------------');
    console.log('  STRESS TEST 1: Student A login');
    console.log('----------------------------------------------------------------------');
    
    console.log('[TEST 1] Student A acquires browser from AUTH_POOL...');
    logState(browserPool.authPool, 'TEST 1 - BEFORE ACQ');
    const slotA = await browserPool.authPool.acquire({
        priority: JOB_PRIORITY.LOGIN,
        requestId: 'req-student-A',
        jobType: 'LOGIN',
        userId: 'student-A'
    });
    logState(browserPool.authPool, 'TEST 1 - AFTER ACQ');
    console.log('[TEST 1] Student A releasing browser...');
    await browserPool.authPool.release(slotA.browserId, slotA.context, 'req-student-A', null, slotA._checkedOutAt);
    logState(browserPool.authPool, 'TEST 1 - AFTER RELEASE');

    // ────────────────────────────────────────────────────────────────────────
    // STRESS TEST 2: Student B login immediately afterwards
    // ────────────────────────────────────────────────────────────────────────
    console.log('\n----------------------------------------------------------------------');
    console.log('  STRESS TEST 2: Student B login immediately afterwards');
    console.log('----------------------------------------------------------------------');
    
    console.log('[TEST 2] Student B acquires browser from AUTH_POOL...');
    logState(browserPool.authPool, 'TEST 2 - BEFORE ACQ');
    const slotB = await browserPool.authPool.acquire({
        priority: JOB_PRIORITY.LOGIN,
        requestId: 'req-student-B',
        jobType: 'LOGIN',
        userId: 'student-B'
    });
    logState(browserPool.authPool, 'TEST 2 - AFTER ACQ');
    console.log('[TEST 2] Student B releasing browser...');
    await browserPool.authPool.release(slotB.browserId, slotB.context, 'req-student-B', null, slotB._checkedOutAt);
    logState(browserPool.authPool, 'TEST 2 - AFTER RELEASE');

    // ────────────────────────────────────────────────────────────────────────
    // STRESS TEST 3: Student C login immediately afterwards
    // ────────────────────────────────────────────────────────────────────────
    console.log('\n----------------------------------------------------------------------');
    console.log('  STRESS TEST 3: Student C login immediately afterwards');
    console.log('----------------------------------------------------------------------');
    
    console.log('[TEST 3] Student C acquires browser from AUTH_POOL...');
    logState(browserPool.authPool, 'TEST 3 - BEFORE ACQ');
    const slotC = await browserPool.authPool.acquire({
        priority: JOB_PRIORITY.LOGIN,
        requestId: 'req-student-C',
        jobType: 'LOGIN',
        userId: 'student-C'
    });
    logState(browserPool.authPool, 'TEST 3 - AFTER ACQ');
    console.log('[TEST 3] Student C releasing browser...');
    await browserPool.authPool.release(slotC.browserId, slotC.context, 'req-student-C', null, slotC._checkedOutAt);
    logState(browserPool.authPool, 'TEST 3 - AFTER RELEASE');

    // ────────────────────────────────────────────────────────────────────────
    // STRESS TEST 4: Logout/Login repeatedly
    // ────────────────────────────────────────────────────────────────────────
    console.log('\n----------------------------------------------------------------------');
    console.log('  STRESS TEST 4: Logout/Login repeatedly (5 cycles)');
    console.log('----------------------------------------------------------------------');
    for (let i = 1; i <= 5; i++) {
        console.log(`[TEST 4] Cycle ${i}: Acquiring browser...`);
        const slot = await browserPool.authPool.acquire({
            priority: JOB_PRIORITY.LOGIN,
            requestId: `req-repeat-cycle-${i}`,
            jobType: 'LOGIN',
            userId: `student-repeat-${i}`
        });
        logState(browserPool.authPool, `CYCLE ${i} - ACTIVE`);
        console.log(`[TEST 4] Cycle ${i}: Releasing browser...`);
        await browserPool.authPool.release(slot.browserId, slot.context, `req-repeat-cycle-${i}`, null, slot._checkedOutAt);
    }
    logState(browserPool.authPool, 'TEST 4 - FINISHED');

    // ────────────────────────────────────────────────────────────────────────
    // STRESS TEST 5: 10 concurrent login requests
    // ────────────────────────────────────────────────────────────────────────
    console.log('\n----------------------------------------------------------------------');
    console.log('  STRESS TEST 5: 10 concurrent login requests');
    console.log('----------------------------------------------------------------------');
    
    console.log('[TEST 5] Launching 10 concurrent login requests against AUTH_POOL (cap=2)...');
    logState(browserPool.authPool, 'TEST 5 - BEFORE STRESS');

    const concurrentLoginsCount = 10;
    const completedLogins = [];
    const loginPromises = [];

    // Periodic state sampling during the concurrent spike
    const sampleInterval = setInterval(() => {
        logState(browserPool.authPool, 'STRESS SPIKE SAMPLE');
    }, 15);

    for (let i = 0; i < concurrentLoginsCount; i++) {
        const p = (async () => {
            const reqId = `req-stress-${i}`;
            const slot = await browserPool.authPool.acquire({
                priority: JOB_PRIORITY.LOGIN,
                requestId: reqId,
                jobType: 'LOGIN',
                userId: `student-stress-${i}`
            });
            
            // Hold slot for 30ms to simulate scrape time
            await sleep(30);
            
            await browserPool.authPool.release(slot.browserId, slot.context, reqId, null, slot._checkedOutAt);
            completedLogins.push(i);
        })();
        loginPromises.push(p);
    }

    await Promise.all(loginPromises);
    clearInterval(sampleInterval);
    
    console.log(`[TEST 5] All ${completedLogins.length}/${concurrentLoginsCount} logins completed.`);
    logState(browserPool.authPool, 'TEST 5 - AFTER STRESS');

    // ────────────────────────────────────────────────────────────────────────
    // STRESS TEST 6: Login while background sync jobs are running
    // ────────────────────────────────────────────────────────────────────────
    console.log('\n----------------------------------------------------------------------');
    console.log('  STRESS TEST 6: Login while background sync jobs are running');
    console.log('----------------------------------------------------------------------');
    
    console.log('[TEST 6] Triggering 10 background sync requests in SYNC_POOL (cap=4)...');
    console.log('[TEST 6] Simultaneously triggering 3 login requests in AUTH_POOL (cap=2)...');
    
    logState(browserPool.authPool, 'AUTH BEFORE SPIKE');
    logState(browserPool.syncPool, 'SYNC BEFORE SPIKE');

    const syncPromises = [];
    for (let i = 0; i < 10; i++) {
        syncPromises.push((async () => {
            const slot = await browserPool.syncPool.acquire({
                priority: JOB_PRIORITY.BACKGROUND_SYNC,
                requestId: `req-sync-bg-${i}`,
                jobType: 'BACKGROUND_SYNC'
            });
            await sleep(40); // sync work takes longer
            await browserPool.syncPool.release(slot.browserId, slot.context, `req-sync-bg-${i}`, null, slot._checkedOutAt);
        })());
    }

    const test6LoginPromises = [];
    const loginTimes = [];
    for (let i = 0; i < 3; i++) {
        test6LoginPromises.push((async () => {
            const tStart = Date.now();
            const slot = await browserPool.authPool.acquire({
                priority: JOB_PRIORITY.LOGIN,
                requestId: `req-sync-login-${i}`,
                jobType: 'LOGIN',
                userId: `student-sync-${i}`
            });
            const tAcquired = Date.now() - tStart;
            loginTimes.push(tAcquired);
            console.log(`[TEST 6] Login ${i} acquired AUTH browser in ${tAcquired}ms (isolated from SYNC pool)`);
            await sleep(15);
            await browserPool.authPool.release(slot.browserId, slot.context, `req-sync-login-${i}`, null, slot._checkedOutAt);
        })());
    }

    await Promise.all([...syncPromises, ...test6LoginPromises]);
    
    console.log('[TEST 6] All concurrent login and sync operations complete.');
    logState(browserPool.authPool, 'AUTH AFTER SPIKE');
    logState(browserPool.syncPool, 'SYNC AFTER SPIKE');

    console.log('\n======================================================================');
    console.log('  ALL STRESS TESTS COMPLETED SUCCESSFULLY');
    console.log('======================================================================\n');
    
    await browserPool.shutdown();
}

runSuite().catch(console.error);
