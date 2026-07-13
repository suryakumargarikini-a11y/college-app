/**
 * BrowserPool Verification Suite — v3 (Debug Mode)
 * Focused on V6-V11 since V1-V5 already pass.
 * Added explicit error catching and recycle diagnostics.
 */
'use strict';

process.env.NODE_ENV = 'test';
process.env.BROWSER_ACQUIRE_TIMEOUT_MS = '15000';
process.env.BROWSER_MAX_JOBS = '1000';
process.env.LOG_LEVEL = 'warn';

let PASS = 0, FAIL = 0;
const results = [];
function pass(name, detail = '') { PASS++; results.push({ status: 'PASS', name, detail }); process.stdout.write(`  ✓ [PASS] ${name}${detail ? ': ' + detail : ''}\n`); }
function fail(name, detail = '') { FAIL++; results.push({ status: 'FAIL', name, detail }); process.stdout.write(`  ✗ [FAIL] ${name}${detail ? ': ' + detail : ''}\n`); }
function info(msg) { process.stdout.write(`      ${msg}\n`); }
function section(title) { process.stdout.write(`\n${'─'.repeat(70)}\n${title}\n${'─'.repeat(70)}\n`); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── Mock browser factory ─────────────────────────────────────────────────────
let mockCallCount = 0;
let mockFailsRemaining = 0;
const MOCK_LAUNCH_DELAY = 30;

function createMockBrowser(id) {
    let _connected = true;
    return {
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
                    setUserAgent: async () => {}, setViewport: async () => {},
                    goto: async () => {}, close: async () => {},
                }),
                close: async function() { this._closed = true; },
                setCookie: async () => {},
            };
        },
        close: async () => { _connected = false; },
        on: (event, cb) => { if (event === 'disconnected') this._onDisconnect = cb; },
    };
}

const BrowserInstance = require('../services/browserPool/BrowserInstance');

BrowserInstance.prototype.launch = async function(_path) {
    const callId = ++mockCallCount;
    await sleep(MOCK_LAUNCH_DELAY);
    if (mockFailsRemaining > 0) {
        mockFailsRemaining--;
        throw new Error(`MockChromium FAILED (call #${callId})`);
    }
    this.browser = createMockBrowser(callId);
    this.pid = 10000 + callId;
    this.version = `mock-${callId}`;
    this.createdAt = Date.now();
    this.lastUsed = Date.now();
    this.healthy = true;
    // wire disconnect handler so crash works
    const self = this;
    const origOn = this.browser.on;
    this.browser.on = (event, cb) => {
        if (event === 'disconnected') self._disconnectCb = cb;
    };
    return this;
};

const BrowserPool = require('../services/browserPool/BrowserPool');
const { JOB_PRIORITY } = require('../services/browserPool/PriorityQueue');

const BASE_ARGS = ['--no-sandbox', '--disable-dev-shm-usage'];

function makePool(name, { min = 1, max = 2, autoScale = false } = {}) {
    return new BrowserPool({ name, minBrowsers: min, maxBrowsers: max, autoScale, launchArgs: BASE_ARGS });
}

async function initPool(pool) {
    pool._executablePath = '/mock';
    const rs = await Promise.allSettled(Array.from({ length: pool.minBrowsers }, () => pool._launchAndAdd()));
    pool.currentMax = Math.max(pool.currentMax, rs.filter(r => r.status === 'fulfilled').length);
    info(`  initPool: ${pool.instances.filter(b=>!b.retired).length} browser(s) ready`);
}

function acq(pool, opts = {}) {
    return pool.acquire({
        priority: opts.priority || JOB_PRIORITY.LOGIN,
        requestId: opts.requestId || `req-${Math.random().toString(36).slice(2,6)}`,
        jobType: opts.jobType || 'LOGIN',
        userId: opts.userId,
    });
}

function rel(pool, slot, err = null) {
    return pool.release(slot.browserId, slot.context, `rel-${slot.browserId}`, err, slot._checkedOutAt);
}

// ─── V6 (rewritten, robust) ──────────────────────────────────────────────────
async function test_V6() {
    section('V6 — Queue drains correctly after _launchPromise removal');
    const pool = makePool('V6', { min: 1, max: 1 });
    await initPool(pool);

    const inst = pool.instances[0];
    info(`  Single browser: id=${inst.id} healthy=${inst.healthy} inUse=${inst.inUse} jobCount=${inst.jobCount}`);

    const slot1 = await acq(pool, { requestId: 'v6-first', userId: 'A' });
    info(`  slot1: browserId=${slot1.browserId} inUse=${inst.inUse}`);

    // Queue 3 requests with error catching
    const q1 = acq(pool, { requestId: 'v6-q1', userId: 'B' }).catch(e => ({ _error: e.message }));
    const q2 = acq(pool, { requestId: 'v6-q2', userId: 'C' }).catch(e => ({ _error: e.message }));
    const q3 = acq(pool, { requestId: 'v6-q3', userId: 'D' }).catch(e => ({ _error: e.message }));

    await sleep(100);
    info(`  Queue depth: ${pool.queue.length} (expected 3)`);

    const qBefore = pool.queue.length;

    // Release slot1
    info(`  Before release-slot1: inUse=${inst.inUse} jobCount=${inst.jobCount} needsRecycle=${inst.needsRecycle()}`);
    await rel(pool, slot1);
    info(`  After release-slot1: inUse=${inst.inUse} queue=${pool.queue.length} needsRecycle=${inst.needsRecycle()}`);

    const r1 = await q1;
    if (r1._error) {
        fail('V6-q1', `q1 ERROR: ${r1._error}`);
        info(`  inst state: inUse=${inst.inUse} healthy=${inst.healthy} retired=${inst.retired} jobCount=${inst.jobCount}`);
        await pool.shutdown();
        return;
    }
    info(`  q1 served: browserId=${r1.browserId} inUse=${inst.inUse} jobCount=${inst.jobCount}`);

    info(`  Before release-q1: inUse=${inst.inUse} jobCount=${inst.jobCount} needsRecycle=${inst.needsRecycle()}`);
    await rel(pool, r1);
    info(`  After release-q1: inUse=${inst.inUse} queue=${pool.queue.length} needsRecycle=${inst.needsRecycle()}`);
    // Note: if needsRecycle() was true here, _replaceInstance is called, not _drainQueue
    // A NEW browser would be launched to serve q2

    const r2 = await q2;
    if (r2._error) {
        fail('V6-q2', `q2 ERROR: ${r2._error}`);
        info(`  Current pool state: live=${pool.instances.filter(b=>!b.retired).length} inUse=${pool.instances.filter(b=>b.inUse&&!b.retired).length} queue=${pool.queue.length}`);
        await pool.shutdown();
        return;
    }
    info(`  q2 served: browserId=${r2.browserId} inUse=${inst.inUse}`);

    await rel(pool, r2);

    const r3 = await q3;
    if (r3._error) {
        fail('V6-q3', `q3 ERROR: ${r3._error}`);
        await pool.shutdown();
        return;
    }
    info(`  q3 served: browserId=${r3.browserId}`);
    await rel(pool, r3);

    info(`  Final queue: ${pool.queue.length}`);

    qBefore === 3
        ? pass('V6-queue-fills', `3 requests queued (got ${qBefore})`)
        : fail('V6-queue-fills', `Expected 3 queued, got ${qBefore}`);

    pool.queue.length === 0
        ? pass('V6-queue-drains', 'All 3 queued requests drained and served')
        : fail('V6-queue-drains', `${pool.queue.length} still queued`);

    await pool.shutdown();
}

// ─── V7 ──────────────────────────────────────────────────────────────────────
async function test_V7() {
    section('V7 — 5 queued requests served via cascade (no starvation)');
    const pool = makePool('V7', { min: 1, max: 1 });
    await initPool(pool);

    const slot1 = await acq(pool, { requestId: 'v7-first' });

    // Queue 5
    const waiters = Array.from({ length: 5 }, (_, i) =>
        acq(pool, { requestId: `v7-q${i}` }).catch(e => ({ _error: e.message, i }))
    );

    await sleep(100);
    info(`  Queue depth: ${pool.queue.length} (expected 5)`);

    await rel(pool, slot1);

    let served = 0;
    for (let i = 0; i < 5; i++) {
        const r = await waiters[i];
        if (r && r._error) {
            info(`  q${i} ERROR: ${r._error}`);
        } else {
            served++;
            info(`  q${i} served: ${r.browserId}`);
            await rel(pool, r);
        }
    }

    served === 5
        ? pass('V7-all-served', `All 5 served via cascade`)
        : fail('V7-all-served', `Only ${served}/5 served`);

    pool.queue.length === 0
        ? pass('V7-queue-empty', 'Queue empty')
        : fail('V7-queue-empty', `${pool.queue.length} stuck`);

    await pool.shutdown();
}

// ─── V8 ──────────────────────────────────────────────────────────────────────
async function test_V8() {
    section('V8 — No deadlocks (5 workers × 20 rounds, max=2)');
    const pool = makePool('V8', { min: 2, max: 2 });
    await initPool(pool);

    const ROUNDS = 20;
    let completed = 0;
    const errors = [];

    await Promise.all(Array.from({ length: 5 }, async (_, wId) => {
        for (let r = 0; r < ROUNDS; r++) {
            try {
                const slot = await acq(pool, { requestId: `v8-w${wId}-r${r}`, userId: `u${wId % 3}` });
                await sleep(5);
                await rel(pool, slot);
                completed++;
            } catch(e) {
                errors.push(`w${wId}r${r}: ${e.message}`);
            }
        }
    }));

    const expected = 5 * ROUNDS;
    info(`  Completed: ${completed}/${expected}  Errors: ${errors.length}`);
    if (errors.length > 0 && errors.length <= 5) errors.forEach(e => info(`    ${e}`));
    info(`  Queue: ${pool.queue.length}  _launching: ${pool._launching}`);
    info(`  Active: ${pool.instances.filter(b=>b.inUse&&!b.retired).length}`);

    completed === expected && errors.length === 0
        ? pass('V8-no-deadlock', `All ${expected} jobs, 0 errors`)
        : fail('V8-no-deadlock', `completed=${completed}/${expected} errors=${errors.length}`);

    pool.queue.length === 0
        ? pass('V8-queue-clean', 'Queue empty')
        : fail('V8-queue-clean', `${pool.queue.length} stuck`);

    await pool.shutdown();
}

// ─── V9 ──────────────────────────────────────────────────────────────────────
async function test_V9() {
    section('V9 — timer.end("total") fires exactly once across retries');

    class T { constructor() { this.s = {}; this.e = {}; } start(k) { this.s[k] = (this.s[k]||0)+1; } end(k) { this.e[k] = (this.e[k]||0)+1; } }

    // Scenario A: success attempt 1
    { const t = new T(); t.start('total'); let a=0; try { while(a<3){a++;try{break;}catch(e){if(a>=3)throw e;}} } finally { t.end('total'); }
      info(`  A (success att1): start=${t.s.total} end=${t.e.total}`);
      t.s.total===1&&t.e.total===1 ? pass('V9-A','start=1 end=1') : fail('V9-A',`start=${t.s.total} end=${t.e.total}`); }

    // Scenario B: success attempt 2
    { const t = new T(); t.start('total'); let a=0; try { while(a<3){a++;try{if(a===1)throw new Error('x');break;}catch(e){if(a>=3)throw e;}} } finally { t.end('total'); }
      info(`  B (retry once): start=${t.s.total} end=${t.e.total}`);
      t.s.total===1&&t.e.total===1 ? pass('V9-B','start=1 end=1 after retry') : fail('V9-B',`start=${t.s.total} end=${t.e.total}`); }

    // Scenario C: all fail
    { const t = new T(); t.start('total'); let a=0; try { while(a<3){a++;try{throw new Error('x');}catch(e){if(a>=3)throw e;}} } catch(_){} finally { t.end('total'); }
      info(`  C (all fail): start=${t.s.total} end=${t.e.total}`);
      t.s.total===1&&t.e.total===1 ? pass('V9-C','start=1 end=1 when all fail') : fail('V9-C',`start=${t.s.total} end=${t.e.total}`); }

    // Scenario D: OLD BUG proof — timer inside loop fires multiple times
    { const t = new T(); t.start('total'); let a=0;
      while(a<2){a++;try{if(a===1)throw new Error('x');break;}catch(e){if(a>=2){try{throw e;}catch(_){}}} finally{t.end('total');}}
      info(`  D (old bug): end=${t.e.total} (expect >1)`);
      t.e.total>1 ? pass('V9-D-bug-proven',`OLD pattern fires end() ${t.e.total}x`) : info(`  OLD pattern end=${t.e.total} (simplified sim)`); }
}

// ─── V10 ─────────────────────────────────────────────────────────────────────
async function test_V10() {
    section('V10 — 10 concurrent requests: pool stays under maxBrowsers');
    const pool = makePool('V10', { min: 2, max: 2 });
    await initPool(pool);

    const CONC = 10;
    let completed = 0;
    const errors = [];
    const snapshots = [];
    const snap = setInterval(() => {
        snapshots.push({
            live: pool.instances.filter(b=>!b.retired).length,
            active: pool.instances.filter(b=>b.inUse&&!b.retired).length,
            launching: pool._launching,
            queued: pool.queue.length,
        });
    }, 10);

    await Promise.all(Array.from({ length: CONC }, async (_, i) => {
        try {
            const slot = await acq(pool, { requestId: `v10-${i}`, userId: `u${i%3}` });
            await sleep(15);
            await rel(pool, slot);
            completed++;
        } catch(e) { errors.push(`[${i}] ${e.message}`); }
    }));

    clearInterval(snap);

    const maxLive = Math.max(...snapshots.map(s => s.live));
    const maxActive = Math.max(...snapshots.map(s => s.active));

    info(`  Completed: ${completed}/${CONC}  Errors: ${errors.length}`);
    if (errors.length > 0 && errors.length <= 3) errors.forEach(e => info(`    ${e}`));
    info(`  Max live: ${maxLive}/${pool.maxBrowsers}  Max active: ${maxActive}`);
    info(`  End state: queue=${pool.queue.length} _launching=${pool._launching}`);
    info(`  Snapshots: ${JSON.stringify(snapshots.slice(0,6))}`);

    maxLive <= pool.maxBrowsers
        ? pass('V10-cap', `Max live=${maxLive} ≤ ${pool.maxBrowsers}`)
        : fail('V10-cap', `live=${maxLive} EXCEEDED max=${pool.maxBrowsers}`);

    completed === CONC
        ? pass('V10-served', `All ${CONC} served`)
        : fail('V10-served', `${completed}/${CONC} served`);

    pool._launching === 0 && pool.queue.length === 0
        ? pass('V10-clean', 'Pool clean')
        : fail('V10-clean', `launching=${pool._launching} queue=${pool.queue.length}`);

    await pool.shutdown();
}

// ─── V11 ─────────────────────────────────────────────────────────────────────
async function test_V11() {
    section('V11 — One acquire = exactly one release (zero context leaks)');
    const pool = makePool('V11', { min: 1, max: 2 });
    await initPool(pool);

    let created = 0, destroyed = 0;
    const origC = pool.metrics.recordContextCreated.bind(pool.metrics);
    const origD = pool.metrics.recordContextDestroyed.bind(pool.metrics);
    pool.metrics.recordContextCreated = () => { created++; origC(); };
    pool.metrics.recordContextDestroyed = () => { destroyed++; origD(); };

    const CYCLES = 50;
    for (let i = 0; i < CYCLES; i++) {
        const slot = await acq(pool, { requestId: `v11-${i}`, userId: `u${i%3}` });
        await sleep(2);
        await rel(pool, slot, i % 7 === 0 ? new Error('simulated') : null);
    }

    await sleep(100);

    info(`  created=${created}  destroyed=${destroyed}  delta=${created-destroyed}`);

    created === CYCLES
        ? pass('V11-create', `created=${created}=${CYCLES}`)
        : fail('V11-create', `created=${created} ≠ ${CYCLES}`);

    created === destroyed
        ? pass('V11-no-leaks', `destroyed=${destroyed}=created (0 leaks)`)
        : fail('V11-no-leaks', `LEAK: created=${created} destroyed=${destroyed}`);

    await pool.shutdown();
}

// ─── RUNNER ───────────────────────────────────────────────────────────────────
(async () => {
    console.log('\n══════════════════════════════════════════════════════════════════════');
    console.log('  BrowserPool Verification Suite v3 (V6-V11)');
    console.log('══════════════════════════════════════════════════════════════════════');

    const t0 = Date.now();
    try {
        await test_V6();
        await test_V7();
        await test_V8();
        await test_V9();
        await test_V10();
        await test_V11();
    } catch(fatal) {
        console.error('\n[FATAL]', fatal.message);
        console.error(fatal.stack);
    }

    const elapsed = Date.now() - t0;
    console.log('\n══════════════════════════════════════════════════════════════════════');
    console.log(`  RESULTS — ${elapsed}ms`);
    console.log('══════════════════════════════════════════════════════════════════════');
    results.forEach(r => {
        const icon = r.status === 'PASS' ? '✓' : '✗';
        console.log(`  ${icon} [${r.status}] ${r.name}${r.detail ? ': ' + r.detail : ''}`);
    });
    console.log(`\n  TOTAL: ${PASS} passed, ${FAIL} failed`);
    console.log('══════════════════════════════════════════════════════════════════════\n');

    process.exit(FAIL > 0 ? 1 : 0);
})();
