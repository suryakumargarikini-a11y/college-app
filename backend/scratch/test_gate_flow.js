const { PrismaClient } = require('@prisma/client');
const http = require('http');
const crypto = require('crypto');

const BASE = 'http://localhost:8080/api';
const prisma = new PrismaClient();

async function request(method, path, body, token) {
    return new Promise((resolve) => {
        const url = new URL(`${BASE}${path}`);
        const data = body ? JSON.stringify(body) : null;
        const options = {
            hostname: url.hostname,
            port: url.port || 80,
            path: url.pathname + (url.search || ''),
            method,
            headers: {
                'Content-Type': 'application/json',
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
                ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {})
            },
            timeout: 15000
        };

        const req = http.request(options, (res) => {
            let raw = '';
            res.on('data', c => raw += c);
            res.on('end', () => {
                let parsed;
                try { parsed = JSON.parse(raw); } catch { parsed = raw; }
                resolve({ status: res.statusCode, body: parsed });
            });
        });

        req.on('error', (e) => resolve({ status: 0, error: e.message }));
        req.on('timeout', () => { req.destroy(); resolve({ status: 0, error: 'timeout' }); });
        if (data) req.write(data);
        req.end();
    });
}

async function loginAdmin(email, password) {
    const r = await request('POST', '/admin/auth/login', { email, password });
    if (r.status === 200 && r.body.token) return r.body.token;
    return null;
}

async function main() {
    console.log('=== Campus Gate Checkout E2E Concurrency & Atomicity Tests ===');
    
    // Acquire tokens
    const superToken = await loginAdmin('admin@sitamecap.co.in', 'Admin@SITAM2024');
    const guardToken = await loginAdmin('guard@sitamecap.co.in', 'Guard@SITAM2024');
    
    if (!superToken || !guardToken) {
        console.error('Failed to log in as admin/guard.');
        process.exit(1);
    }
    
    // Fetch a student from the DB
    const student = await prisma.student.findFirst();
    if (!student) {
        console.error('No students found in DB to attach test passes.');
        process.exit(1);
    }
    
    console.log(`Using test student: ${student.name} (${student.roll})`);

    // ─────────────────────────────────────────────────────────────────────────
    // Test 1: confirmExit (APPROVED -> EXITED) Concurrency & Atomicity
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n--- Test 1: confirmExit Concurrency (APPROVED -> EXITED) ---');
    
    // Create a new APPROVED pass
    const pass1 = await prisma.exitPass.create({
        data: {
            studentId: student.id,
            reason: 'Gate test 1',
            destination: 'Local market',
            requestedDate: 'Jul 20, 2026',
            status: 'APPROVED',
            otpHash: 'dummy-otp-hash',
            otpExpiry: new Date(Date.now() + 60 * 60 * 1000)
        }
    });
    console.log(`Created APPROVED pass: ${pass1.id}`);

    // Send 2 concurrent confirmExit requests in parallel
    const p1 = request('POST', `/admin/exit-passes/${pass1.id}/confirm-exit`, { gate: 'MAIN_GATE', verificationMethod: 'QR_SCAN' }, guardToken);
    const p2 = request('POST', `/admin/exit-passes/${pass1.id}/confirm-exit`, { gate: 'MAIN_GATE', verificationMethod: 'QR_SCAN' }, guardToken);
    
    const [res1, res2] = await Promise.all([p1, p2]);
    
    console.log(`Request 1 response: status=${res1.status}, body=${JSON.stringify(res1.body)}`);
    console.log(`Request 2 response: status=${res2.status}, body=${JSON.stringify(res2.body)}`);

    // Verify atomicity: exactly one must return status 200/success=true, and the other must fail/ALREADY_USED
    const states = [res1, res2];
    const successCount = states.filter(r => r.status === 200 && r.body.success === true).length;
    const alreadyUsedCount = states.filter(r => r.status === 200 && r.body.error === 'This pass has already been used to exit.').length;

    console.log(`Successful checkout confirmations: ${successCount}`);
    console.log(`Blocked duplicate checkouts (ALREADY_USED): ${alreadyUsedCount}`);

    if (successCount === 1 && alreadyUsedCount === 1) {
        console.log('✓ SUCCESS: confirmExit concurrency is perfectly atomic! Duplicate checkout blocked.');
    } else {
        console.error('✗ FAILURE: Concurrency anomaly detected!');
    }

    // Verify final database state
    const dbPass1 = await prisma.exitPass.findUnique({ where: { id: pass1.id } });
    console.log(`DB final pass state: status=${dbPass1.status}, exitConfirmedAt=${dbPass1.exitConfirmedAt}, exitConfirmedBy=${dbPass1.exitConfirmedBy}`);
    
    // Check audit logs
    const auditLogs1 = await prisma.auditLog.findMany({
        where: {
            studentId: student.id,
            action: 'EXIT_PASS_CONFIRMED'
        }
    });
    console.log(`DB Audit log count for pass: ${auditLogs1.length}`);
    if (auditLogs1.length === 1) {
        console.log(`✓ SUCCESS: Audit log verified: "${auditLogs1[0].details}"`);
    } else {
        console.error(`✗ FAILURE: Expected 1 audit log, got ${auditLogs1.length}`);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Test 2: rejectIdentity (APPROVED -> UNDER_REVIEW) Concurrency
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n--- Test 2: rejectIdentity Concurrency (APPROVED -> UNDER_REVIEW) ---');

    // Create a new APPROVED pass
    const pass2 = await prisma.exitPass.create({
        data: {
            studentId: student.id,
            reason: 'Gate test 2',
            destination: 'Local market',
            requestedDate: 'Jul 20, 2026',
            status: 'APPROVED',
            otpHash: 'dummy-otp-hash',
            otpExpiry: new Date(Date.now() + 60 * 60 * 1000)
        }
    });
    console.log(`Created APPROVED pass: ${pass2.id}`);

    // Send 2 concurrent rejectIdentity requests in parallel
    const p3 = request('POST', `/admin/exit-passes/${pass2.id}/reject-identity`, { reason: 'Photo mismatch' }, guardToken);
    const p4 = request('POST', `/admin/exit-passes/${pass2.id}/reject-identity`, { reason: 'Name mismatch' }, guardToken);

    const [res3, res4] = await Promise.all([p3, p4]);

    console.log(`Request 3 response: status=${res3.status}, body=${JSON.stringify(res3.body)}`);
    console.log(`Request 4 response: status=${res4.status}, body=${JSON.stringify(res4.body)}`);

    // Verify atomicity: exactly one must return status 200, and the other must return status 400 (already in UNDER_REVIEW)
    const successReject = [res3, res4].filter(r => r.status === 200 && r.body.success === true).length;
    const failedConflict = [res3, res4].filter(r => r.status === 400).length;

    console.log(`Successful identity rejections: ${successReject}`);
    console.log(`Blocked conflicting rejections: ${failedConflict}`);

    if (successReject === 1 && failedConflict === 1) {
        console.log('✓ SUCCESS: rejectIdentity concurrency is perfectly atomic! Conflicting action blocked.');
    } else {
        console.error('✗ FAILURE: Concurrency anomaly detected for rejectIdentity!');
    }

    // Verify final database state
    const dbPass2 = await prisma.exitPass.findUnique({ where: { id: pass2.id } });
    console.log(`DB final pass state: status=${dbPass2.status}, identityMismatchReason="${dbPass2.identityMismatchReason}"`);

    // Check audit logs
    const auditLogs2 = await prisma.auditLog.findMany({
        where: {
            studentId: student.id,
            action: 'IDENTITY_MISMATCH_REPORTED'
        }
    });
    console.log(`DB Audit log count for identity mismatch: ${auditLogs2.length}`);
    if (auditLogs2.length === 1) {
        console.log(`✓ SUCCESS: Audit log verified: "${auditLogs2[0].details}"`);
    } else {
        console.error(`✗ FAILURE: Expected 1 audit log, got ${auditLogs2.length}`);
    }

    // Clean up test records
    await prisma.exitPass.deleteMany({
        where: { id: { in: [pass1.id, pass2.id] } }
    });
    await prisma.auditLog.deleteMany({
        where: { studentId: student.id, action: { in: ['EXIT_PASS_CONFIRMED', 'IDENTITY_MISMATCH_REPORTED'] } }
    });
    console.log('\n--- Cleanup complete! ---');
    
    await prisma.$disconnect();
}

main();
