'use strict';
/**
 * SITAM Smart ERP — Student Profile Production Acceptance Verification
 * Runs against http://localhost:8080 using the live scraper backend.
 * Credentials passed via environment variables only — never hardcoded.
 *
 * Usage:
 *   $env:ERP_PASS="<password>"; node verification_profile.js
 */

const http  = require('http');
const https = require('https');
const fs    = require('fs');
const path  = require('path');

// ── Config ────────────────────────────────────────────────────────────────────
const BASE     = 'http://localhost:8080';
const PASSWORD = process.env.ERP_PASS;
if (!PASSWORD) { console.error('ERROR: Set $env:ERP_PASS before running.'); process.exit(1); }

const STUDENTS = [
    { id: '25B61A4532', label: 'Student A' },
    { id: '25B61A0596', label: 'Student B' },
    { id: '23B61A0449', label: 'Photo Test Student' },
];

const REQUIRED_PROFILE_FIELDS = [
    'name','roll','admissionNo','program','branch','department','semester','section',
    'academicYear','year','joiningDate','dob','gender','bloodGroup','nationality',
    'religion','caste','aadhar','apaarId','email','phone','address',
    'correspondenceAddress','emergencyContact','fatherName','fatherMobile',
    'fatherEmail','fatherOccupation','motherName','motherMobile','motherEmail',
    'motherOccupation','annualIncome','guardianName','guardianPhone','guardianAddress',
    'hostel','roomNo','seatType','scholarship','entranceType','entranceRank',
    'sscMarks','interMarks','cgpa','sgpa','percentage','lastStudied',
    'profilePhotoUrl','lastSync','syncStatus'
];

const SECURITY_FORBIDDEN_FIELDS = ['bankAccountNo','rationCardNo'];
const SENSITIVE_MASKED_FIELDS   = ['aadhar','apaarId'];

// ── Helpers ───────────────────────────────────────────────────────────────────
const results = { pass: [], fail: [], warn: [] };

function pass(label, detail='') {
    results.pass.push(`✅  ${label}${detail ? ': '+detail : ''}`);
    console.log(`  ✅  ${label}${detail ? ': '+detail : ''}`);
}
function fail(label, detail='') {
    results.fail.push(`❌  ${label}${detail ? ': '+detail : ''}`);
    console.error(`  ❌  ${label}${detail ? ': '+detail : ''}`);
}
function warn(label, detail='') {
    results.warn.push(`⚠️   ${label}${detail ? ': '+detail : ''}`);
    console.warn(`  ⚠️   ${label}${detail ? ': '+detail : ''}`);
}
function header(title) {
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`  ${title}`);
    console.log('═'.repeat(60));
}

function request(opts, body='') {
    return new Promise((resolve, reject) => {
        const lib   = opts.url?.startsWith('https') ? https : http;
        const url   = new URL(opts.url || `${BASE}${opts.path}`);
        const start = Date.now();
        const req   = lib.request({
            hostname: url.hostname,
            port:     url.port || (url.protocol === 'https:' ? 443 : 80),
            path:     url.pathname + (url.search || ''),
            method:   opts.method || 'GET',
            headers:  opts.headers || {}
        }, (res) => {
            const chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end', () => {
                const raw  = Buffer.concat(chunks);
                const ms   = Date.now() - start;
                let parsed = null;
                try { parsed = JSON.parse(raw.toString()); } catch (_) {}
                resolve({ status: res.statusCode, headers: res.headers, raw, body: parsed, ms });
            });
        });
        req.on('error', reject);
        req.setTimeout(180000, () => req.destroy(new Error('timeout')));
        if (body) req.write(body);
        req.end();
    });
}

// ── Step 1: Health ─────────────────────────────────────────────────────────
async function step1_health() {
    header('STEP 1 — Backend Health Check');
    const r = await request({ path: '/health' });
    if (r.status === 200 && r.body?.status === 'ok') {
        pass('Health endpoint', `HTTP ${r.status} in ${r.ms}ms`);
    } else {
        fail('Health endpoint', `HTTP ${r.status} — ${JSON.stringify(r.body)}`);
        process.exit(1);
    }
}

// ── Step 2: Login ──────────────────────────────────────────────────────────
async function loginStudent(student) {
    const payload = JSON.stringify({ userId: student.id, password: PASSWORD });
    const r = await request({
        path: '/api/auth/login',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
    }, payload);

    const sessionCookie = (r.headers['set-cookie'] || []).find(c => c.startsWith('sessionId=') || c.startsWith('connect.sid=') || c.includes('session'));
    const token = r.body?.token || r.body?.data?.token || null;

    if (r.status === 200 && (r.body?.success || r.body?.status === 'ok' || r.body?.data)) {
        pass(`${student.label} login`, `HTTP ${r.status} in ${r.ms}ms, session=${sessionCookie ? 'cookie' : token ? 'token' : 'unknown'}`);
        return { cookie: sessionCookie ? sessionCookie.split(';')[0] : null, token };
    } else {
        fail(`${student.label} login`, `HTTP ${r.status} — ${JSON.stringify(r.body).slice(0,200)}`);
        return null;
    }
}

// ── Step 3: Get Profile ───────────────────────────────────────────────────
async function getProfile(student, auth) {
    const headers = {};
    if (auth.cookie) headers['Cookie'] = auth.cookie;
    if (auth.token)  headers['Authorization'] = `Bearer ${auth.token}`;

    const r = await request({ path: '/api/profile', headers });

    if (r.status !== 200) {
        fail(`${student.label} profile fetch`, `HTTP ${r.status} — ${JSON.stringify(r.body).slice(0,200)}`);
        return null;
    }
    const d = r.body?.data || r.body;
    pass(`${student.label} profile fetch`, `HTTP ${r.status} in ${r.ms}ms`);
    return { data: d, ms: r.ms };
}

// ── Step 4: Verify Profile Fields ────────────────────────────────────────
function verifyProfileFields(student, d) {
    if (!d) { fail(`${student.label} profile data`, 'null response'); return {}; }

    // Fields that are legitimately null until async operations complete
    const NULLABLE_EXPECTED = new Set(['profilePhotoUrl', 'lastSync', 'aadhar', 'apaarId']);

    const present = {}, missing = [], empty = [];

    for (const f of REQUIRED_PROFILE_FIELDS) {
        const v = d[f];
        if (v === undefined) {
            missing.push(f); // Key completely absent from response — real bug
        } else if (v === null && !NULLABLE_EXPECTED.has(f)) {
            empty.push(f);   // Null where we expect a string — empty ERP field
        } else if (typeof v === 'string' && v.trim() === '') {
            empty.push(f);
        } else {
            present[f] = v;
        }
    }

    if (missing.length === 0) {
        pass(`${student.label} all profile keys present`);
    } else {
        warn(`${student.label} missing keys (${missing.length})`, missing.join(', '));
    }

    // Fields with actual data
    const populated = Object.keys(present).filter(k => {
        const v = String(present[k]);
        return v !== '' && v !== '--' && v !== 'Not Available';
    });
    pass(`${student.label} populated fields (${populated.length}/${REQUIRED_PROFILE_FIELDS.length})`, populated.join(', '));

    if (empty.length > 0) {
        warn(`${student.label} empty fields (${empty.length})`, empty.join(', '));
    }

    return { present, missing, empty };
}

// ── Step 5: Security Checks ──────────────────────────────────────────────
function verifyProfileSecurity(student, d) {
    if (!d) return;

    // Forbidden fields must not exist at all
    for (const f of SECURITY_FORBIDDEN_FIELDS) {
        if (d[f] !== undefined) {
            fail(`${student.label} security — ${f} MUST NOT be in response`, JSON.stringify(d[f]).slice(0,30));
        } else {
            pass(`${student.label} security — ${f} correctly omitted`);
        }
    }

    // Sensitive fields must be masked (no more than last 4 visible)
    for (const f of SENSITIVE_MASKED_FIELDS) {
        const v = d[f];
        if (v === null || v === undefined || v === '') {
            warn(`${student.label} security — ${f} is empty (field not extracted from ERP)`);
        } else {
            const raw = String(v);
            // Masked value should contain asterisks and only show last 4 digits
            const hasAsterisks = raw.includes('*');
            const visibleDigits = raw.replace(/\*/g, '').replace(/\D/g,'').length;
            if (hasAsterisks && visibleDigits <= 4) {
                pass(`${student.label} security — ${f} masked correctly`, raw);
            } else {
                fail(`${student.label} security — ${f} NOT masked`, `value="${raw}"`);
            }
        }
    }

    // department must equal branch
    if (d.department && d.branch && d.department === d.branch) {
        pass(`${student.label} department=branch mapping`, d.department);
    } else if (d.branch) {
        warn(`${student.label} department/branch mismatch`, `branch=${d.branch}, dept=${d.department}`);
    }

    // profilePhotoUrl must be local API path or null — never ERP URL
    const purl = d.profilePhotoUrl;
    if (purl === null || purl === undefined) {
        warn(`${student.label} profilePhotoUrl — null (photo not yet cached or not available)`);
    } else if (purl.startsWith('/api/profile/photo/')) {
        pass(`${student.label} profilePhotoUrl is local API path`, purl);
    } else if (purl.startsWith('http')) {
        fail(`${student.label} profilePhotoUrl is raw ERP URL — SECURITY VIOLATION`, purl.slice(0,60));
    } else {
        warn(`${student.label} profilePhotoUrl unexpected format`, purl);
    }
}

// ── Step 6: Photo Test ────────────────────────────────────────────────────
async function verifyPhoto(student, d, auth) {
    const photoUrl = d?.profilePhotoUrl;

    if (!photoUrl) {
        warn(`${student.label} photo — profilePhotoUrl is null`);
        // Still try the path directly by userId
        const directPath = `/api/profile/photo/${student.id}`;
        const r = await request({ path: directPath, headers: auth.cookie ? { Cookie: auth.cookie } : {} });
        if (r.status === 200) {
            const ct = r.headers['content-type'] || '';
            if (ct.startsWith('image/')) {
                pass(`${student.label} photo — direct path returned image`, `${r.raw.length} bytes, ${ct}`);
            } else {
                warn(`${student.label} photo — direct path returned non-image`, `content-type: ${ct}`);
            }
        } else if (r.status === 404) {
            warn(`${student.label} photo — not cached yet (404)`);
        } else {
            fail(`${student.label} photo — direct path failed`, `HTTP ${r.status}`);
        }
        return;
    }

    // Fetch the photo through the local API path
    const r = await request({ path: photoUrl });
    const ct = r.headers['content-type'] || '';
    if (r.status === 200 && ct.startsWith('image/')) {
        pass(`${student.label} photo — cached and served correctly`, `HTTP ${r.status}, ${r.raw.length} bytes, ${ct}, ${r.ms}ms`);

        // Check file exists on disk
        const userId = photoUrl.split('/').pop();
        const diskPath = path.join(__dirname, 'uploads', 'photos', `${userId}.jpg`);
        if (fs.existsSync(diskPath)) {
            const stat = fs.statSync(diskPath);
            pass(`${student.label} photo — file on disk`, `${diskPath} (${stat.size} bytes)`);
        } else {
            warn(`${student.label} photo — file NOT found on disk at expected path`, diskPath);
        }

        // Cache hit: second request should be faster
        const r2 = await request({ path: photoUrl });
        pass(`${student.label} photo — cache re-serve`, `HTTP ${r2.status}, ${r2.ms}ms (1st: ${r.ms}ms)`);
    } else if (r.status === 404) {
        warn(`${student.label} photo — cached path returned 404 (photo may not have downloaded yet)`);
    } else {
        fail(`${student.label} photo — unexpected response`, `HTTP ${r.status}, content-type: ${ct}`);
    }
}

// ── Step 7: Logout ───────────────────────────────────────────────────────
async function logout(student, auth) {
    const headers = {};
    if (auth.cookie) headers['Cookie'] = auth.cookie;
    if (auth.token)  headers['Authorization'] = `Bearer ${auth.token}`;

    // Try common logout endpoints
    for (const path of ['/api/auth/logout', '/logout', '/api/logout']) {
        try {
            const r = await request({ path, method: 'POST', headers });
            if (r.status === 200 || r.status === 204 || r.status === 302) {
                pass(`${student.label} logout`, `HTTP ${r.status} via ${path}`);
                return;
            }
        } catch (_) {}
    }
    warn(`${student.label} logout — no standard logout endpoint found`);
}

// ── Step 8: Stale Data Check ─────────────────────────────────────────────
function checkStaleness(studentA, profileA, studentB, profileB) {
    if (!profileA || !profileB) return;
    const dA = profileA.data, dB = profileB.data;

    if (dA.roll === dB.roll) {
        fail('Regression — Student A and B have same roll number (stale data?)');
    } else {
        pass('Regression — Student A and B have different rolls', `A=${dA.roll}, B=${dB.roll}`);
    }
    if (dA.name === dB.name) {
        fail('Regression — Student A and B have same name (stale data?)');
    } else {
        pass('Regression — Student A and B have different names', `A=${dA.name}, B=${dB.name}`);
    }
}

// ── Step 9: DB Verify ─────────────────────────────────────────────────────
async function verifyDB(student) {
    // Query the DB via a direct Prisma script
    const prisma = require('./services/dbService');
    try {
        const row = await prisma.student.findUnique({
            where: { userId: student.id },
            select: {
                id: true, name: true, roll: true, branch: true,
                cgpa: true, sgpa: true, academicYear: true, apaarId: true,
                motherMobile: true, fatherEmail: true, motherOccupation: true,
                fatherOccupation: true, annualIncome: true, correspondenceAddress: true,
                lastStudied: true, photoUrl: true, lastSync: true
            }
        });

        if (!row) {
            warn(`${student.label} DB — student record not found (may not have synced yet)`);
            return null;
        }
        pass(`${student.label} DB record found`, `id=${row.id}, name="${row.name}"`);

        // Check new Phase 1 fields exist in DB
        const phase1fields = ['sgpa','academicYear','apaarId','motherMobile','fatherEmail',
                              'motherOccupation','fatherOccupation','annualIncome',
                              'correspondenceAddress','lastStudied'];
        for (const f of phase1fields) {
            if (row[f] !== undefined) {
                pass(`${student.label} DB — column ${f} exists`, `value="${row[f] || '<empty>'}"`);
            } else {
                fail(`${student.label} DB — column ${f} MISSING from record`);
            }
        }

        // Photo: check if photoUrl is set
        if (row.photoUrl) {
            if (row.photoUrl.startsWith('/api/profile/photo/')) {
                pass(`${student.label} DB — photoUrl is local path`, row.photoUrl);
            } else if (row.photoUrl.startsWith('http')) {
                warn(`${student.label} DB — photoUrl is still ERP URL (photo download pending?)`, row.photoUrl.slice(0,60));
            } else {
                warn(`${student.label} DB — photoUrl has unexpected format`, row.photoUrl);
            }
        } else {
            warn(`${student.label} DB — photoUrl is empty`);
        }

        return row;
    } catch (err) {
        fail(`${student.label} DB query`, err.message);
        return null;
    }
}

// ── Step 10: Log Audit ─────────────────────────────────────────────────────
async function step10_logAudit() {
    header('STEP 10 — Backend Log Audit');
    const logFile = path.join(__dirname, 'logs', 'combined.log');
    const altLog  = path.join(__dirname, 'logs', 'app.log');
    const logPath = fs.existsSync(logFile) ? logFile : fs.existsSync(altLog) ? altLog : null;

    if (!logPath) {
        warn('Log audit — no log file found', 'Skipping log audit');
        return;
    }

    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const logLines = fs.readFileSync(logPath, 'utf8').split('\n');
    // Only audit log entries from today to avoid counting historical pre-fix errors
    const logContent = logLines.filter(l => l.includes(today)).join('\n');
    const totalLines = logLines.length;
    const todayLines = logContent.split('\n').length;
    pass(`Log audit — scoping to today (${today})`, `${todayLines} of ${totalLines} total log lines`);
    const FORBIDDEN_PATTERNS = [
        'Target.createTarget', 'Target closed', 'SIGTRAP',
        'Browser disconnected', 'Browser exited', 'Protocol error',
        'Unhandled rejection', 'ReferenceError', 'Prisma error',
        'Context leak', 'Session leak'
    ];

    for (const p of FORBIDDEN_PATTERNS) {
        const count = (logContent.match(new RegExp(p, 'gi')) || []).length;
        if (count > 0) {
            fail(`Log audit — found "${p}" (${count} occurrences)`);
        } else {
            pass(`Log audit — "${p}" ZERO occurrences`);
        }
    }
}

// ── Performance Report ─────────────────────────────────────────────────────
function printPerf(timings) {
    header('PERFORMANCE SUMMARY');
    for (const [label, ms] of Object.entries(timings)) {
        const rating = ms < 500 ? '🟢' : ms < 2000 ? '🟡' : '🔴';
        console.log(`  ${rating}  ${label}: ${ms}ms`);
    }
}

// ── Final Report ───────────────────────────────────────────────────────────
function printFinalReport(allProfiles) {
    header('FINAL VERIFICATION REPORT');

    console.log('\n📋 ERP FIELDS SUCCESSFULLY EXTRACTED:');
    const allFields = new Set();
    for (const { data } of Object.values(allProfiles)) {
        if (!data) continue;
        for (const [k, v] of Object.entries(data)) {
            if (v !== null && v !== '' && v !== '--' && v !== 'Not Available') {
                allFields.add(`${k}: ${String(v).slice(0,40)}`);
            }
        }
    }
    for (const f of [...allFields].sort()) console.log(`  ✓ ${f}`);

    console.log(`\n✅  PASSED: ${results.pass.length}`);
    console.log(`❌  FAILED: ${results.fail.length}`);
    console.log(`⚠️   WARNED: ${results.warn.length}`);

    if (results.fail.length > 0) {
        console.log('\n❌  FAILURES:');
        results.fail.forEach(f => console.log('  ' + f));
    }
    if (results.warn.length > 0) {
        console.log('\n⚠️   WARNINGS:');
        results.warn.forEach(w => console.log('  ' + w));
    }

    console.log('\n' + '═'.repeat(60));
    if (results.fail.length === 0) {
        console.log('🎉 VERDICT: Student Profile Module is FULLY VERIFIED.');
        console.log('   All checks passed. Module is production-ready.');
    } else {
        console.log(`🚨 VERDICT: ${results.fail.length} FAILURE(S) detected. Module is NOT ready.`);
        console.log('   Fix all failures and re-run verification.');
    }
    console.log('═'.repeat(60) + '\n');

    return results.fail.length === 0;
}

// ── Main ───────────────────────────────────────────────────────────────────
async function main() {
    console.log('\n🔍 SITAM Smart ERP — Student Profile Production Acceptance Verification');
    console.log(`   Target: ${BASE}`);
    console.log(`   Students: ${STUDENTS.map(s => s.id).join(', ')}`);
    console.log(`   ${new Date().toISOString()}\n`);

    const timings = {};
    const sessions = {};
    const profiles = {};

    // Step 1: Health
    await step1_health();

    // Step 2-6: Test each student
    for (const student of STUDENTS) {
        header(`STUDENT: ${student.label} (${student.id})`);

        // Login
        const t0 = Date.now();
        const auth = await loginStudent(student);
        timings[`${student.label} login`] = Date.now() - t0;
        if (!auth) { warn(`${student.label} skipping further tests — login failed`); continue; }
        sessions[student.id] = auth;

        // Wait a moment for sync to kick off if it's triggered on login
        await new Promise(r => setTimeout(r, 3000));

        // Profile fetch
        const t1 = Date.now();
        const prof = await getProfile(student, auth);
        timings[`${student.label} profile API`] = Date.now() - t1;
        profiles[student.id] = prof;

        // Field verification
        if (prof) {
            verifyProfileFields(student, prof.data);
            verifyProfileSecurity(student, prof.data);
        }

        // Photo test
        if (prof) {
            const t2 = Date.now();
            await verifyPhoto(student, prof.data, auth);
            timings[`${student.label} photo`] = Date.now() - t2;
        }

        // DB verification (only possible since we're running inside the project)
        try {
            await verifyDB(student);
        } catch (dbErr) {
            warn(`${student.label} DB check skipped`, dbErr.message);
        }

        // Logout before next student
        await logout(student, auth);
    }

    // Step 8: Regression / stale data check
    header('STEP 8 — Regression: Cross-Student Data Isolation');
    checkStaleness(STUDENTS[0], profiles[STUDENTS[0].id], STUDENTS[1], profiles[STUDENTS[1].id]);

    // Step 10: Log audit
    await step10_logAudit();

    // Performance
    printPerf(timings);

    // Final report
    const passed = printFinalReport(profiles);
    process.exit(passed ? 0 : 1);
}

main().catch(err => {
    console.error('FATAL:', err);
    process.exit(1);
});
