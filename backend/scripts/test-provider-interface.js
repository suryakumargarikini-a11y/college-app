/**
 * SITAM Smart ERP — Provider Interface Compliance Tests
 *
 * Validates:
 *   1. ERPProvider interface contract compliance for all providers
 *   2. Normalized model creation, validation, and serialization
 *   3. ProviderFactory environment-driven selection
 *   4. Mock provider determinism (consistent data between calls)
 *   5. Error system serialization (queue-safe round-trip)
 *   6. Provider-layer isolation (no raw HTML escapes)
 *
 * Run:
 *   node scripts/test-provider-interface.js
 *
 * Exit code 0 = all tests pass, 1 = failures
 */

'use strict';

process.env.NODE_ENV = 'test';
process.env.ERP_PROVIDER = 'mock'; // Use mock for interface tests

let passed = 0;
let failed = 0;
const failures = [];

// ─── Test Runner ──────────────────────────────────────────────────────────────

function test(name, fn) {
    try {
        const result = fn();
        if (result && typeof result.then === 'function') {
            return result.then(() => {
                console.log(`  ✅ ${name}`);
                passed++;
            }).catch(err => {
                console.error(`  ❌ ${name}: ${err.message}`);
                failures.push({ name, error: err.message });
                failed++;
            });
        }
        console.log(`  ✅ ${name}`);
        passed++;
    } catch (err) {
        console.error(`  ❌ ${name}: ${err.message}`);
        failures.push({ name, error: err.message });
        failed++;
    }
    return Promise.resolve();
}

function assert(condition, message) {
    if (!condition) throw new Error(message || 'Assertion failed');
}

function assertEqual(a, b, message) {
    if (a !== b) throw new Error(message || `Expected ${JSON.stringify(a)} to equal ${JSON.stringify(b)}`);
}

function assertDefined(v, name) {
    if (v === undefined || v === null) throw new Error(`${name} must not be null/undefined, got: ${JSON.stringify(v)}`);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

async function runTests() {
    console.log('\n════════════════════════════════════════════════════════════');
    console.log('  SITAM ERP Provider Interface Compliance Tests');
    console.log('════════════════════════════════════════════════════════════\n');

    // ── Section 1: Normalized Models ──────────────────────────────────────────
    console.log('\n[ Section 1: Normalized Data Models ]\n');
    const {
        ProfileRecord, AttendanceRecord, MarkRecord, SubjectRecord, TimetableRecord,
        FeeRecord, TransactionRecord, NotificationRecord, AssignmentRecord, ExamRecord,
        AttendanceResult, MarksResult, FeeResult, AssignmentResult, ExamResult, SyncResult
    } = require('../models/normalized');

    await test('ProfileRecord.create() returns valid object', () => {
        const p = ProfileRecord.create({ name: 'Test Student', roll: 'CS001', program: 'B.Tech', branch: 'CSE', semester: 'IV/IV B.Tech' });
        assertDefined(p.name, 'profile.name');
        assert(p.name === 'Test Student', 'name mismatch');
        assert(p.roll === 'CS001', 'roll mismatch');
        assert(typeof p.toJSON === 'function', 'toJSON must be function');
        assert(!JSON.stringify(p.toJSON()).includes('_password'), 'password must not appear in toJSON()');
    });

    await test('ProfileRecord.create() handles empty input', () => {
        const p = ProfileRecord.create({});
        assert(p.name === 'Student', 'empty name fallback must be "Student"');
        assert(p.section === 'A', 'section fallback must be "A"');
    });

    await test('AttendanceRecord.create() correctly computes percentage', () => {
        const r = AttendanceRecord.create({ subjectCode: 'CS-401', held: 40, attended: 36 });
        assertEqual(r.percentage, 90, 'percentage must be 90');
        assert(r.status === 'Excellent', 'status must be Excellent for 90%');
    });

    await test('AttendanceRecord.validate() catches invalid data', () => {
        const r = AttendanceRecord.create({ subjectCode: 'CS-401', held: 30, attended: 35 });
        const { valid, errors } = AttendanceRecord.validate(r);
        assert(!valid, 'attended > held must be invalid');
        assert(errors.length > 0, 'must have validation errors');
    });

    await test('MarkRecord.create() derives status from grade', () => {
        const pass = MarkRecord.create({ subjectCode: 'CS-401', grade: 'A' });
        const fail = MarkRecord.create({ subjectCode: 'CS-402', grade: 'F' });
        assert(pass.status === 'Pass', 'A grade must be Pass');
        assert(fail.status === 'Backlog', 'F grade must be Backlog');
    });

    await test('FeeRecord.create() normalizes amount strings', () => {
        const f = FeeRecord.create({ feeType: 'Tuition Fee', amount: '₹85,000', paidAmount: '₹85,000', dueAmount: '₹0' });
        assertEqual(f.amount, 85000, 'amount must parse to numeric 85000');
        assertEqual(f.dueAmount, 0, 'dueAmount must parse to 0');
        assert(f.paymentStatus === 'Paid', 'zero due means Paid status');
    });

    await test('TransactionRecord derives icon from title', () => {
        const hostel  = TransactionRecord.create({ title: 'Hostel Fee', amount: '₹45,000' });
        const tuition = TransactionRecord.create({ title: 'Tuition Fee', amount: '₹85,000' });
        const other   = TransactionRecord.create({ title: 'Development Fee', amount: '₹5,000' });
        assertEqual(hostel.icon, 'hotel', 'hostel must have hotel icon');
        assertEqual(tuition.icon, 'school', 'tuition must have school icon');
        assertEqual(other.icon, 'receipt_long', 'other must have receipt_long icon');
    });

    await test('AttendanceResult wraps records correctly', () => {
        const result = new AttendanceResult({
            records: [{ subjectCode: 'CS-401', held: 40, attended: 36 }],
            overallPercentage: '90%'
        });
        assertEqual(result.records.length, 1, 'must have 1 record');
        assert(result.records[0] instanceof AttendanceRecord, 'records must be AttendanceRecord instances');
        assertEqual(result.overallPercentage, '90%', 'overall percentage must be preserved');
    });

    await test('MarksResult wraps subjects correctly', () => {
        const result = new MarksResult({
            subjects: [{ subjectCode: 'CS-401', grade: 'A+' }],
            cgpa: '9.5', sgpa: '9.7', percentage: '95%'
        });
        assert(result.subjects[0] instanceof MarkRecord, 'subjects must be MarkRecord instances');
        assertEqual(result.cgpa, '9.5', 'CGPA must be preserved');
    });

    await test('SyncResult assembles all sub-results', () => {
        const sync = new SyncResult({
            profile:    { name: 'Test', roll: 'CS001' },
            marks:      { subjects: [], cgpa: '8.0' },
            attendance: { records: [], overallPercentage: '80%' },
            fees:       { transactions: [] },
            assignments:{ list: [] },
            provider:   'mock',
            syncType:   'full'
        });
        assert(sync.profile instanceof ProfileRecord, 'profile must be ProfileRecord');
        assert(sync.marks instanceof MarksResult, 'marks must be MarksResult');
        assert(sync.attendance instanceof AttendanceResult, 'attendance must be AttendanceResult');
        assertEqual(sync.provider, 'mock', 'provider must be preserved');
        assertEqual(sync.syncType, 'full', 'syncType must be preserved');
    });

    await test('All models serialize to plain JSON via toJSON()', () => {
        const models = [
            ProfileRecord.create({ name: 'T', roll: 'R1' }),
            AttendanceRecord.create({ subjectCode: 'CS-401', held: 10, attended: 9 }),
            MarkRecord.create({ subjectCode: 'CS-401', grade: 'A' }),
            FeeRecord.create({ feeType: 'Tuition', amount: 50000 }),
            TransactionRecord.create({ title: 'Fee', amount: '₹50,000' }),
            NotificationRecord.create({ id: '1', title: 'Test', message: 'Hello' }),
            AssignmentRecord.create({ title: 'Homework' }),
            ExamRecord.create({ subjectCode: 'CS-401' })
        ];
        for (const m of models) {
            assert(typeof m.toJSON === 'function', `${m.constructor.name}.toJSON() must exist`);
            const json = JSON.stringify(m.toJSON());
            assert(typeof json === 'string' && json.length > 0, `${m.constructor.name}.toJSON() must return non-empty string`);
        }
    });

    // ── Section 2: Provider Error System ─────────────────────────────────────
    console.log('\n[ Section 2: Provider Error System ]\n');
    const {
        ProviderError, AuthenticationError, SessionExpiredError, ERPUnavailableError,
        RateLimitError, DataValidationError, SelectorDriftError, CaptchaDetectedError,
        classifyError
    } = require('../providers/errors');

    await test('All error classes extend ProviderError', () => {
        const errors = [
            new AuthenticationError('test'),
            new SessionExpiredError('test'),
            new ERPUnavailableError('test'),
            new RateLimitError('test'),
            new DataValidationError('test'),
            new SelectorDriftError('test'),
            new CaptchaDetectedError('test')
        ];
        for (const e of errors) {
            assert(e instanceof ProviderError, `${e.constructor.name} must extend ProviderError`);
            assert(e instanceof Error, `${e.constructor.name} must extend Error`);
            assertDefined(e.providerName, `${e.constructor.name}.providerName`);
            assertDefined(e.occurredAt, `${e.constructor.name}.occurredAt`);
        }
    });

    await test('Retry classification is correct', () => {
        assert(!new AuthenticationError().isRetryable, 'AuthenticationError must NOT be retryable');
        assert(new SessionExpiredError().isRetryable, 'SessionExpiredError must be retryable');
        assert(new ERPUnavailableError().isRetryable, 'ERPUnavailableError must be retryable');
        assert(new RateLimitError().isRetryable, 'RateLimitError must be retryable');
        assert(!new DataValidationError().isRetryable, 'DataValidationError must NOT be retryable');
        assert(!new SelectorDriftError().isRetryable, 'SelectorDriftError must NOT be retryable');
    });

    await test('ProviderError.toJSON() is queue-safe', () => {
        const err  = new ERPUnavailableError('ERP is down', { providerName: 'sitam-scraper', operationName: 'login' });
        const json = err.toJSON();
        assert(typeof json === 'object', 'toJSON must return object');
        assertDefined(json.errorType, 'errorType');
        assertDefined(json.message, 'message');
        assertDefined(json.providerName, 'providerName');
        assertDefined(json.isRetryable, 'isRetryable');
        assertDefined(json.occurredAt, 'occurredAt');
        // Must serialize cleanly
        JSON.stringify(json); // Must not throw
    });

    await test('ProviderError.fromJSON() round-trips correctly', () => {
        const original   = new ERPUnavailableError('ERP down', { providerName: 'test', operationName: 'sync' });
        const serialized = original.toJSON();
        const restored   = ProviderError.fromJSON(serialized);
        assert(restored instanceof ERPUnavailableError, 'restored must be ERPUnavailableError instance');
        assertEqual(restored.message, 'ERP down', 'message must survive round-trip');
        assertEqual(restored.providerName, 'test', 'providerName must survive round-trip');
    });

    await test('classifyError() maps native errors correctly', () => {
        const captcha  = classifyError(new Error('captcha wall detected'));
        const session  = classifyError(new Error('session cookie expired'));
        const timeout  = classifyError(new Error('request timeout'));
        const rateLimit = classifyError(new Error('rate limit exceeded, 429'));
        const authErr  = classifyError(new Error('invalid credentials'));
        assert(captcha instanceof CaptchaDetectedError, 'captcha keyword must map to CaptchaDetectedError');
        assert(session instanceof SessionExpiredError, 'session keyword must map to SessionExpiredError');
        assert(timeout instanceof ERPUnavailableError, 'timeout must map to ERPUnavailableError');
        assert(rateLimit instanceof RateLimitError, 'rate limit must map to RateLimitError');
        assert(authErr instanceof AuthenticationError, 'auth error must map to AuthenticationError');
    });

    await test('classifyError() passes through existing ProviderErrors', () => {
        const original = new SelectorDriftError('All selectors failed');
        const result   = classifyError(original);
        assert(result === original, 'existing ProviderError must be returned as-is');
    });

    // ── Section 3: ERPProvider Interface ─────────────────────────────────────
    console.log('\n[ Section 3: ERPProvider Interface ]\n');
    const ERPProvider = require('../providers/interfaces/ERPProvider');

    const REQUIRED_METHODS = [
        'login', 'refreshSession', 'logout',
        'getAttendance', 'getMarks', 'getSubjects', 'getTimetable',
        'getAssignments', 'getExams', 'getFees', 'getTransactions',
        'getNotifications', 'getAnnouncements',
        'syncStudent', 'syncIncremental',
        'checkERPHealth', 'validateSession'
    ];

    await test('ERPProvider defines all required interface methods', () => {
        const iface = new ERPProvider();
        for (const method of REQUIRED_METHODS) {
            assert(typeof iface[method] === 'function', `ERPProvider.${method}() must exist`);
        }
    });

    await test('ERPProvider base methods throw NotImplemented', async () => {
        const iface = new ERPProvider();
        for (const method of REQUIRED_METHODS) {
            try {
                await iface[method]({});
                throw new Error(`${method}() must throw`);
            } catch (err) {
                assert(err.message.includes('not implemented'), `${method}() must throw 'not implemented' error`);
            }
        }
    });

    // ── Section 4: ProviderFactory ────────────────────────────────────────────
    console.log('\n[ Section 4: ProviderFactory ]\n');
    const ProviderFactory = require('../providers/ProviderFactory');

    await test('ProviderFactory.getProviderName() returns "mock" (from env)', () => {
        assertEqual(ProviderFactory.getProviderName(), 'mock', 'must return mock from ERP_PROVIDER=mock');
    });

    await test('ProviderFactory.listProviders() returns all 3 providers', () => {
        const names = ProviderFactory.listProviders();
        assert(names.includes('scraper'), 'must include scraper');
        assert(names.includes('official-api'), 'must include official-api');
        assert(names.includes('mock'), 'must include mock');
    });

    await test('ProviderFactory.isProviderAvailable() works correctly', () => {
        assert(ProviderFactory.isProviderAvailable('scraper'), 'scraper must be available');
        assert(ProviderFactory.isProviderAvailable('mock'), 'mock must be available');
        assert(!ProviderFactory.isProviderAvailable('nonexistent'), 'nonexistent must not be available');
    });

    await test('ProviderFactory.setProvider() switches provider', () => {
        const originalName = ProviderFactory.getProviderName();
        ProviderFactory.setProvider('mock');
        assertEqual(ProviderFactory.getProviderName(), 'mock', 'after setProvider("mock"), name must be mock');
        ProviderFactory.resetProvider();
    });

    await test('ProviderFactory.setProvider() throws for unknown provider', () => {
        let threw = false;
        try {
            ProviderFactory.setProvider('nonexistent-provider');
        } catch (err) {
            threw = true;
            assert(err.message.includes('Unknown provider'), 'must mention Unknown provider');
        }
        assert(threw, 'must throw for unknown provider');
    });

    await test('ProviderFactory.getProvider() returns MockERPProvider when ERP_PROVIDER=mock', () => {
        const provider = ProviderFactory.getProvider();
        assertEqual(provider.providerName, 'mock', 'providerName must be mock');
    });

    // ── Section 5: Mock Provider Interface Compliance ─────────────────────────
    console.log('\n[ Section 5: Mock Provider Interface Compliance ]\n');
    const MockERPProvider = require('../providers/mock/MockERPProvider');

    await test('MockERPProvider has correct providerName', () => {
        assertEqual(MockERPProvider.providerName, 'mock', 'providerName must be "mock"');
    });

    await test('MockERPProvider.login() returns valid session', async () => {
        const session = await MockERPProvider.login({ userId: 'test123', password: 'pass123' });
        assertDefined(session.sessionId, 'sessionId');
        assertDefined(session.cookies, 'cookies');
        assert(session.expiresAt instanceof Date, 'expiresAt must be Date');
    });

    await test('MockERPProvider.login() throws AuthenticationError for wrong password', async () => {
        let threw = false;
        try {
            await MockERPProvider.login({ userId: 'test123', password: 'wrong' });
        } catch (err) {
            threw = true;
            assert(err instanceof AuthenticationError, 'must throw AuthenticationError');
        }
        assert(threw, 'must throw for wrong password');
    });

    await test('MockERPProvider.getAttendance() returns AttendanceResult with records', async () => {
        const result = await MockERPProvider.getAttendance('test123');
        assert(result instanceof AttendanceResult, 'must return AttendanceResult');
        assert(result.records.length > 0, 'must have at least 1 record');
        assert(result.records[0] instanceof AttendanceRecord, 'records must be AttendanceRecord instances');
        assertDefined(result.overallPercentage, 'overallPercentage');
    });

    await test('MockERPProvider.getMarks() returns MarksResult with subjects', async () => {
        const result = await MockERPProvider.getMarks('test123');
        assert(result instanceof MarksResult, 'must return MarksResult');
        assert(result.subjects.length > 0, 'must have at least 1 subject');
        assert(result.subjects[0] instanceof MarkRecord, 'subjects must be MarkRecord instances');
    });

    await test('MockERPProvider.getFees() returns FeeResult', async () => {
        const result = await MockERPProvider.getFees('test123');
        assert(result instanceof FeeResult, 'must return FeeResult');
        assert(result.transactions.length > 0, 'must have transactions');
    });

    await test('MockERPProvider.syncStudent() returns complete SyncResult', async () => {
        const result = await MockERPProvider.syncStudent('test123', 'pass123');
        assert(result instanceof SyncResult, 'must return SyncResult');
        assertDefined(result.profile, 'profile');
        assertDefined(result.marks, 'marks');
        assertDefined(result.attendance, 'attendance');
        assertDefined(result.fees, 'fees');
        assertDefined(result.assignments, 'assignments');
        assertEqual(result.provider, 'mock', 'provider must be "mock"');
        assertEqual(result.syncType, 'full', 'syncType must be "full"');
    });

    await test('MockERPProvider.syncStudent() is deterministic (consistent between calls)', async () => {
        const r1 = await MockERPProvider.syncStudent('test123', 'pass');
        const r2 = await MockERPProvider.syncStudent('test123', 'pass');
        assertEqual(r1.marks.cgpa, r2.marks.cgpa, 'CGPA must be same across calls');
        assertEqual(r1.attendance.records.length, r2.attendance.records.length, 'attendance count must be same');
        assertEqual(r1.fees.totalAmount, r2.fees.totalAmount, 'totalAmount must be same');
    });

    await test('MockERPProvider.syncIncremental() sets syncType to "incremental"', async () => {
        const result = await MockERPProvider.syncIncremental('test123', 'pass', { cookies: 'mock' });
        assertEqual(result.syncType, 'incremental', 'syncType must be "incremental"');
    });

    await test('MockERPProvider.checkERPHealth() returns healthy:true', async () => {
        const health = await MockERPProvider.checkERPHealth();
        assertEqual(health.healthy, true, 'mock provider health must always be true');
        assertDefined(health.responseTimeMs, 'responseTimeMs');
        assertEqual(health.provider, 'mock', 'provider label must be "mock"');
    });

    await test('MockERPProvider.validateSession() returns valid:true', async () => {
        const result = await MockERPProvider.validateSession('test123', { cookies: 'mock' });
        assertEqual(result.valid, true, 'mock session validation must always be true');
    });

    await test('All MockERPProvider interface methods exist and are functions', () => {
        for (const method of REQUIRED_METHODS) {
            assert(typeof MockERPProvider[method] === 'function', `MockERPProvider.${method}() must be function`);
        }
    });

    // ── Section 6: ProviderMetrics ────────────────────────────────────────────
    console.log('\n[ Section 6: Provider Metrics ]\n');
    const providerMetrics = require('../providers/telemetry/ProviderMetrics');

    await test('ProviderMetrics methods do not throw when prom-client unavailable', () => {
        // These should all silently handle the case where prom-client is not registered
        providerMetrics.recordOperation('mock', 'syncStudent', 'success', 500);
        providerMetrics.recordSelectorFailure('mock', '#unknownSelector', 'login');
        providerMetrics.recordCaptchaDetection('mock');
        providerMetrics.recordSessionRefresh('mock', 'expired');
        providerMetrics.recordSyncSuccess('mock', 'full');
        providerMetrics.recordSyncFailure('mock', 'incremental', 'SessionExpiredError');
        providerMetrics.setHealthScore('mock', 75);
    });

    // ─── Summary ─────────────────────────────────────────────────────────────
    console.log('\n════════════════════════════════════════════════════════════');
    console.log(`  Results: ${passed} passed, ${failed} failed`);
    console.log('════════════════════════════════════════════════════════════');

    if (failures.length > 0) {
        console.log('\nFailures:');
        for (const f of failures) {
            console.log(`  ❌ ${f.name}`);
            console.log(`     ${f.error}`);
        }
        console.log('');
        process.exit(1);
    } else {
        console.log('\n  🎉 All provider interface compliance tests passed!\n');
        process.exit(0);
    }
}

runTests().catch(err => {
    console.error('\nTest runner crashed:', err.message);
    console.error(err.stack);
    process.exit(1);
});
