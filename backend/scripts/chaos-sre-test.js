/**
 * SITAM Smart ERP — SRE & Autonomous Operations Validation Suite
 *
 * Automated verification of control-plane SRE components:
 *   1. SRE API & Status Board
 *   2. Cryptographic Audit Chain & Tamper Detection
 *   3. Consensus Proposal & Quorum Voting Simulation
 *   4. Alertmanager Webhook Integration & Auto-Remediation loops
 *   5. Tenant Quota Isolation & Throttling Guards
 *
 * Usage:
 *   # Against Render production (default):
 *   node scripts/chaos-sre-test.js
 *
 *   # Against local backend:
 *   TARGET_URL=http://localhost:3001 node scripts/chaos-sre-test.js
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const assert = require('assert').strict;

const TARGET_URL = process.env.TARGET_URL || 'https://web-production-07b0.up.railway.app';

const C = {
    reset: '\x1b[0m', green: '\x1b[32m', yellow: '\x1b[33m',
    red: '\x1b[31m', cyan: '\x1b[36m', bold: '\x1b[1m', dim: '\x1b[2m',
};

let passed = 0;
let failed = 0;

// ─── HTTP Client Helper ────────────────────────────────────────────────────────
function request(method, pathUrl, body = null) {
    return new Promise((resolve, reject) => {
        const url = new URL(pathUrl, TARGET_URL);
        const bodyStr = body ? JSON.stringify(body) : null;

        const options = {
            method,
            hostname: url.hostname,
            port: url.port || 80,
            path: url.pathname + url.search,
            headers: {
                'Content-Type': 'application/json',
                'x-sre-role': 'admin', // Access role for SRE endpoints
                ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
            },
            timeout: 10000,
        };

        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve({ status: res.statusCode, body: JSON.parse(data), raw: data });
                } catch (_) {
                    resolve({ status: res.statusCode, body: null, raw: data });
                }
            });
        });

        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
        if (bodyStr) req.write(bodyStr);
        req.end();
    });
}

async function runTest(name, fn) {
    process.stdout.write(`  ${C.dim}Verifying:${C.reset} ${name}... `);
    try {
        await fn();
        console.log(`${C.green}✓ PASSED${C.reset}`);
        passed++;
    } catch (err) {
        console.log(`${C.red}✗ FAILED${C.reset}`);
        console.log(`     ${C.red}Reason: ${err.message}${C.reset}`);
        failed++;
    }
}

// ─── Verification Scenarios ──────────────────────────────────────────────────

async function testSreStatus() {
    const res = await request('GET', '/api/sre/status');
    assert.equal(res.status, 200, `Expected 200, got ${res.status}`);
    assert.equal(res.body.status, 'success');
    assert.ok(typeof res.body.reliabilityIndex === 'number', 'reliabilityIndex must be a number');
    assert.ok(res.body.components.postgresql !== undefined, 'PostgreSQL stats missing');
}

async function testLedgerIntegrity() {
    const res = await request('GET', '/api/sre/ledger/verify');
    assert.equal(res.status, 200, `Expected 200, got ${res.status}`);
    assert.equal(res.body.status, 'verified');
}

async function testConsensusProposal() {
    const res = await request('POST', '/api/sre/consensus/propose', {
        actionType: 'globalQueuePurge',
        payload: { queue: 'sitam-sync' }
    });
    assert.equal(res.status, 200, `Expected 200, got ${res.status}`);
    assert.equal(res.body.status, 'consensus_evaluated');
    assert.ok(res.body.proposalId !== undefined, 'Proposal ID missing');
    assert.ok(typeof res.body.approved === 'boolean', 'approved boolean check missing');
}

async function testAlertmanagerRemediationWebhook() {
    const res = await request('POST', '/api/sre/remedy/webhook', {
        groupKey: 'test-group',
        status: 'firing',
        alerts: [
            {
                labels: { alertname: 'BrowserPoolExhausted', severity: 'CRITICAL' },
                annotations: { summary: 'Active browsers contexts saturated' }
            }
        ]
    });
    assert.equal(res.status, 200, `Expected 200, got ${res.status}`);
    assert.equal(res.body.status, 'processed');
    assert.ok(res.body.results.length > 0, 'No remediation outcomes reported');
    assert.equal(res.body.results[0].remedy.executed, true, 'Remediation was not executed');
}

async function testTenantThrottling() {
    const testUserId = 'test-student-999';
    const sreService = require('../services/sreService');

    // Register multiple requests simulating concurrent access
    const res1 = await sreService.registerTenantRequest(testUserId);
    const res2 = await sreService.registerTenantRequest(testUserId);

    assert.ok(res2.isThrottled, 'Tenant should be throttled under concurrent access');

    // Clean up
    await sreService.releaseTenantRequest(testUserId);
    await sreService.releaseTenantRequest(testUserId);
}

async function testLedgerTamperingDetection() {
    // Write a corrupted block to the JSON ledger
    const ledgerPath = path.join(__dirname, '../logs/sre_audit_ledger.json');
    const backupContent = fs.readFileSync(ledgerPath, 'utf8');

    try {
        const ledger = JSON.parse(backupContent);
        ledger.push({
            index: 9999,
            timestamp: new Date().toISOString(),
            actionType: 'MALICIOUS_TAMPER',
            payload: '{}',
            prevBlockHash: 'fake-hash',
            blockHash: 'corrupted-block-hash'
        });
        fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2), 'utf8');

        // Execute verify endpoint — must return 412 status (Precondition Failed / Tampered)
        const res = await request('GET', '/api/sre/ledger/verify');
        assert.equal(res.status, 412, `Expected 412 when ledger is tampered, got ${res.status}`);
        assert.equal(res.body.status, 'tampered', 'Integrity check must fail when ledger is corrupted');

    } finally {
        // Restore backup file
        fs.writeFileSync(ledgerPath, backupContent, 'utf8');
    }
}

// ─── Main Runner ──────────────────────────────────────────────────────────────
async function main() {
    console.log(`\n${C.bold}${C.cyan}SITAM ERP — SRE Control Plane Validation Suite${C.reset}`);
    console.log(`  Target: ${TARGET_URL}\n`);

    try {
        // Test connectivity
        await request('GET', '/api/sre/status');
    } catch (err) {
        console.error(`  ${C.red}SRE API is unreachable: ${err.message}${C.reset}`);
        console.error(`  Make sure you start the backend before running chaos validations.`);
        process.exit(1);
    }

    await runTest('Status board returns component details', testSreStatus);
    await runTest('Immutable ledger verify reports valid', testLedgerIntegrity);
    await runTest('Consensus Quorum proposal voting succeeds', testConsensusProposal);
    await runTest('Alertmanager webhook invokes auto-remediations', testAlertmanagerRemediationWebhook);
    await runTest('Tenant isolation limits concurrent checkouts', testTenantThrottling);
    await runTest('Cryptographic verification detects audit tampering', testLedgerTamperingDetection);

    const total = passed + failed;
    console.log('\n' + C.bold + '═'.repeat(65) + C.reset);
    console.log(`  Passed: ${C.green}${passed}${C.reset} | Failed: ${failed > 0 ? C.red : C.green}${failed}${C.reset}`);
    console.log(C.bold + '═'.repeat(65) + C.reset);

    process.exit(failed === 0 ? 0 : 1);
}

main().catch(err => {
    console.error('Validation runner crashed:', err);
    process.exit(1);
});
