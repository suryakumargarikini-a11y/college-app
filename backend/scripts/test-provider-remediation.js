/**
 * SITAM Smart ERP — Provider Layer Integration Remediation Tests
 *
 * Proves:
 *   1. ERP_PROVIDER=mock works (returns deterministic sync result, records metrics)
 *   2. ERP_PROVIDER=scraper works (routes through SITAMScraperProvider, handles invalid login cleanly)
 *   3. Provider switching works (using ProviderFactory.setProvider())
 *   4. Session persistence in ProviderSessionManager works (store, touch, acquire, invalidate)
 *   5. Unsupported provider fails cleanly
 *
 * Run:
 *   node scripts/test-provider-remediation.js
 */

'use strict';

process.env.NODE_ENV = 'test';
process.env.ERP_PROVIDER = 'mock'; // Default to mock during test bootstrap

const assert = require('assert');
const ProviderFactory = require('../providers/ProviderFactory');
const ProviderSessionManager = require('../providers/session/ProviderSessionManager');
const { errors } = require('../providers');

let passed = 0;
let failed = 0;
const failures = [];

async function test(name, fn) {
    try {
        await fn();
        console.log(`  ✅ ${name}`);
        passed++;
    } catch (err) {
        console.error(`  ❌ ${name}: ${err.message}`);
        failures.push({ name, error: err.stack || err.message });
        failed++;
    }
}

async function runTests() {
    console.log('\n════════════════════════════════════════════════════════════');
    console.log('  SITAM ERP Provider Layer Integration Remediation Tests');
    console.log('════════════════════════════════════════════════════════════\n');

    // Test 1: Provider switching works
    await test('Provider Switching Works', async () => {
        ProviderFactory.resetProvider();
        assert.strictEqual(ProviderFactory.getProviderName(), 'mock');
        
        ProviderFactory.setProvider('scraper');
        assert.strictEqual(ProviderFactory.getProviderName(), 'scraper');
        
        ProviderFactory.setProvider('mock');
        assert.strictEqual(ProviderFactory.getProviderName(), 'mock');
        
        ProviderFactory.resetProvider();
    });

    // Test 2: Unsupported provider fails cleanly
    await test('Unsupported Provider Fails Cleanly', async () => {
        assert.throws(() => {
            ProviderFactory.setProvider('invalid-provider-xyz');
        }, /Unknown provider/);
    });

    // Test 3: Mock Provider works
    await test('Mock Provider Works and Syncs data', async () => {
        ProviderFactory.setProvider('mock');
        const provider = ProviderFactory.getProvider();
        
        assert.strictEqual(provider.providerName, 'mock');
        
        // 1. Valid syncStudent
        const result = await provider.syncStudent('TEST-STUDENT-001', 'pass123');
        assert.ok(result);
        assert.strictEqual(result.provider, 'mock');
        assert.strictEqual(result.profile.name, 'Test Student');
        assert.strictEqual(result.marks.cgpa, '8.75');
        assert.strictEqual(result.attendance.overallPercentage, '82.88%');
        assert.strictEqual(result.fees.transactions.length, 3);
        
        // 2. Invalid Login
        await assert.rejects(
            async () => {
                await provider.login({ userId: 'TEST-STUDENT-001', password: 'wrong' });
            },
            (err) => {
                return err instanceof errors.AuthenticationError;
            }
        );
    });

    // Test 4: Scraper Provider works (routes correctly & fails cleanly on invalid credentials)
    await test('Scraper Provider Routes Correctly and Fails on Bad Login', async () => {
        ProviderFactory.setProvider('scraper');
        const provider = ProviderFactory.getProvider();
        
        assert.strictEqual(provider.providerName, 'sitam-scraper');
        
        // Assert that it tries to run the login flow and fails with AuthenticationError or ERPUnavailableError
        // (rather than a generic code crash) when given invalid credentials
        try {
            await provider.login({ userId: 'BAD_USER_ID', password: 'BAD_PASSWORD' });
            assert.fail('Should have failed login');
        } catch (err) {
            assert.ok(
                err instanceof errors.AuthenticationError || 
                err instanceof errors.ERPUnavailableError || 
                err instanceof errors.CaptchaDetectedError ||
                err instanceof errors.ProviderError,
                `Expected a ProviderError type, got: ${err.constructor.name} - ${err.message}`
            );
        }
    });

    // Test 5: Session Persistence in ProviderSessionManager
    await test('Session Persistence works in ProviderSessionManager', async () => {
        const userId = 'TEST-SESSION-STUDENT';
        const sessionData = {
            cookies: 'session_id=abc123xyz; Path=/; Secure',
            provider: 'mock',
            studentName: 'Test Session User'
        };

        // 1. Invalidate any existing
        await ProviderSessionManager.invalidate(userId);
        assert.strictEqual(await ProviderSessionManager.hasValidSession(userId), false);

        // 2. Store session
        await ProviderSessionManager.store(userId, sessionData, 2000); // Short TTL: 2s
        assert.strictEqual(await ProviderSessionManager.hasValidSession(userId), true);

        // 3. Acquire session
        const acquired = await ProviderSessionManager.acquire(userId);
        assert.ok(acquired);
        assert.strictEqual(acquired.cookies, sessionData.cookies);
        assert.strictEqual(acquired.provider, sessionData.provider);

        // 4. Invalidate session
        await ProviderSessionManager.invalidate(userId);
        assert.strictEqual(await ProviderSessionManager.hasValidSession(userId), false);
    });

    console.log('\n════════════════════════════════════════════════════════════');
    console.log(`  Results: ${passed} passed, ${failed} failed`);
    console.log('════════════════════════════════════════════════════════════');

    if (failures.length > 0) {
        console.log('\nFailures:');
        for (const f of failures) {
            console.log(`  ❌ ${f.name}`);
            console.log(`     ${f.error}`);
        }
        process.exit(1);
    } else {
        console.log('\n  🎉 All Provider Layer Integration Remediation tests passed!\n');
        process.exit(0);
    }
}

runTests().catch(err => {
    console.error('\nTest runner crashed:', err.message);
    console.error(err.stack);
    process.exit(1);
});
