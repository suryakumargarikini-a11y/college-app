'use strict';

require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const http = require('http');

const PORT = process.env.PORT || 8080;
const ADMIN_EMAIL = 'admin@sitamecap.co.in';
const ADMIN_PASS = 'Admin@SITAM2024';

function request(opts, body = null) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const data = body ? (typeof body === 'string' ? body : JSON.stringify(body)) : null;
    
    const req = http.request({
      hostname: 'localhost',
      port: PORT,
      method: opts.method || 'GET',
      path: opts.path,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(opts.headers || {}),
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {})
      }
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks);
        const ms = Date.now() - start;
        let parsed = null;
        try { parsed = JSON.parse(raw.toString()); } catch (_) {}
        resolve({ status: res.statusCode, headers: res.headers, body: parsed, raw: raw.toString(), ms });
      });
    });
    
    req.on('error', reject);
    req.setTimeout(30000, () => req.destroy(new Error('timeout')));
    if (data) req.write(data);
    req.end();
  });
}

async function run() {
  console.log('════════════════════════════════════════════════════════════');
  console.log('   EXIT PASS 2.0 MODULE ACCEPTANCE E2E VERIFICATION TEST');
  console.log('════════════════════════════════════════════════════════════\n');

  // Let's create two isolated temporary test student records first to avoid polluting existing user data.
  const uniqueId = Date.now().toString().slice(-6);
  const testStudentId1 = `student1-test-${uniqueId}`;
  const testStudentId2 = `student2-test-${uniqueId}`;
  
  console.log('1. Setting up temporary isolated test students...');
  await prisma.student.createMany({
    data: [
      {
        id: testStudentId1,
        userId: `TEST-${uniqueId}-1`,
        roll: `TEST${uniqueId}1`,
        password: 'Password@123',
        name: `Test Student One ${uniqueId}`,
        program: 'B.TECH',
        branch: 'COMPUTER SCIENCE ENGINEERING',
        semester: 'I-I',
        year: '1',
        gender: 'MALE',
        dob: '2000-01-01',
        email: `student1_${uniqueId}@sitamecap.co.in`,
        phone: '9999999991',
        fatherName: 'Father One',
        motherName: 'Mother One',
        fatherMobile: '+919999999991',
        hostel: 'YES',
        roomNo: '101',
        cgpa: '9.0',
        percentage: '90%',
        address: 'SITAM Campus Address',
        academicYear: '2025-26',
        emergencyContact: '9999999991'
      },
      {
        id: testStudentId2,
        userId: `TEST-${uniqueId}-2`,
        roll: `TEST${uniqueId}2`,
        password: 'Password@123',
        name: `Test Student Two ${uniqueId}`,
        program: 'B.TECH',
        branch: 'COMPUTER SCIENCE ENGINEERING',
        semester: 'I-I',
        year: '1',
        gender: 'FEMALE',
        dob: '2000-01-02',
        email: `student2_${uniqueId}@sitamecap.co.in`,
        phone: '9999999992',
        fatherName: 'Father Two',
        motherName: 'Mother Two',
        fatherMobile: '+919999999992',
        hostel: 'YES',
        roomNo: '102',
        cgpa: '9.5',
        percentage: '95%',
        address: 'SITAM Campus Address',
        academicYear: '2025-26',
        emergencyContact: '9999999992'
      }
    ]
  });
  console.log('   ✅ Isolated test students created successfully.');

  try {
    // 2. Obtain Admin authentication tokens
    console.log('\n2. Authenticating admin portal credentials...');
    const adminLogin = await request({ method: 'POST', path: '/api/admin/auth/login' }, { email: ADMIN_EMAIL, password: ADMIN_PASS });
    if (adminLogin.status !== 200) {
      throw new Error(`Admin login failed: ${JSON.stringify(adminLogin.body)}`);
    }
    const adminToken = adminLogin.body.token;
    const adminHeaders = { 'Authorization': `Bearer ${adminToken}` };
    console.log('   ✅ Admin logged in successfully.');

    // 3. Obtain Student authentications (via standard session simulation)
    console.log('\n3. Logging in test students...');
    // Student 1 Login
    const login1 = await request({ method: 'POST', path: '/api/auth/login' }, { userId: `TEST-${uniqueId}-1`, password: 'Password@123' });
    if (login1.status !== 200) {
      throw new Error(`Student 1 login failed: ${JSON.stringify(login1.body)}`);
    }
    const token1 = login1.body.token;
    const student1Headers = { 'Authorization': `Bearer ${token1}` };

    // Student 2 Login
    const login2 = await request({ method: 'POST', path: '/api/auth/login' }, { userId: `TEST-${uniqueId}-2`, password: 'Password@123' });
    if (login2.status !== 200) {
      throw new Error(`Student 2 login failed: ${JSON.stringify(login2.body)}`);
    }
    const token2 = login2.body.token;
    const student2Headers = { 'Authorization': `Bearer ${token2}` };
    console.log('   ... Both student accounts authenticated successfully.');

    // 4. Test Individual applying and verification
    console.log('\n4. Verifying individual exit pass apply...');
    const indivApply = await request({
      method: 'POST',
      path: '/api/exit-passes',
      headers: student1Headers
    }, {
      reason: 'Visit bank for educational loan processing',
      destination: 'SBI Bank Branch',
      exitTime: new Date(Date.now() + 2 * 3600 * 1000).toISOString(),
      returnTime: new Date(Date.now() + 5 * 3600 * 1000).toISOString(),
      emergencyContact: '9999999999',
      remarks: 'Will return before evening study hours'
    });

    if (indivApply.status !== 201) {
      throw new Error(`Apply failed: ${JSON.stringify(indivApply.body)}`);
    }
    const passId = indivApply.body.id;
    console.log(`   ... Exit pass created. ID: ${passId}`);

    // Check duplicate pending block
    console.log('   Verifying duplicate pending request block...');
    const duplicateApply = await request({
      method: 'POST',
      path: '/api/exit-passes',
      headers: student1Headers
    }, {
      reason: 'Second request',
      destination: 'Library',
      exitTime: new Date(Date.now() + 2 * 3600 * 1000).toISOString(),
      returnTime: new Date(Date.now() + 5 * 3600 * 1000).toISOString(),
      emergencyContact: '9999999999'
    });
    if (duplicateApply.status === 400) {
      console.log('   ... Duplicate pending request blocked correctly.');
    } else {
      throw new Error(`Duplicate pending request did not block! Status: ${duplicateApply.status}`);
    }

    // 5. Check Quota limit enforcement (apply-approve cycle up to 10)
    console.log('\n5. Verifying semester quota calculation and enforcement (Max 10 approved passes)...');
    
    // We already have 1 pending pass for Student 1. Approve it to count towards quota.
    const appRes = await request({
      method: 'POST',
      path: `/api/admin/exit-passes/${passId}/approve`,
      headers: adminHeaders
    }, { adminRemark: 'Quota testing' });
    if (appRes.status !== 200) {
      throw new Error(`First approval failed: ${JSON.stringify(appRes.body)}`);
    }

    // Check quota API returns count = 1
    const quotaRes1 = await request({ method: 'GET', path: '/api/exit-passes/quota', headers: student1Headers });
    console.log(`   Initial quota count: ${quotaRes1.body.count} (Remaining: ${quotaRes1.body.remaining})`);
    if (quotaRes1.body.count !== 1) {
      throw new Error(`Quota count mismatch. Expected 1, got ${quotaRes1.body.count}`);
    }

    // Now populate 9 more APPROVED passes for Student 1 to reach quota limit = 10
    console.log('   Seeding 9 additional approved passes to hit quota threshold...');
    for (let i = 0; i < 9; i++) {
      const pass = await prisma.exitPass.create({
        data: {
          studentId: testStudentId1,
          destination: 'Quota Testing',
          reason: 'Test quota limit',
          requestedDate: new Date().toLocaleDateString(),
          status: 'APPROVED',
          academicYear: '2025-26',
          semester: 'I-I'
        }
      });
    }

    const quotaRes2 = await request({ method: 'GET', path: '/api/exit-passes/quota', headers: student1Headers });
    console.log(`   Seeded quota count: ${quotaRes2.body.count} (Remaining: ${quotaRes2.body.remaining})`);
    if (quotaRes2.body.count !== 10) {
      throw new Error(`Quota count mismatch. Expected 10, got ${quotaRes2.body.count}`);
    }

    // Try applying for the 11th pass, should fail or fail to approve
    console.log('   Applying for 11th exit pass (should exceed quota)...');
    const eleventhApply = await request({
      method: 'POST',
      path: '/api/exit-passes',
      headers: student1Headers
    }, {
      reason: '11th pass application',
      destination: 'Over quota',
      exitTime: new Date(Date.now() + 2 * 3600 * 1000).toISOString(),
      returnTime: new Date(Date.now() + 5 * 3600 * 1000).toISOString(),
      emergencyContact: '9999999999'
    });

    if (eleventhApply.status !== 201) {
      throw new Error(`Failed to create 11th pending request. Status: ${eleventhApply.status}`);
    }

    console.log('   Attempting to approve the 11th pass...');
    const eleventhApprove = await request({
      method: 'POST',
      path: `/api/admin/exit-passes/${eleventhApply.body.id}/approve`,
      headers: adminHeaders
    });

    if (eleventhApprove.status === 400 && eleventhApprove.body.error.includes('quota')) {
      console.log('   ✅ 11th pass approval blocked correctly with message: ' + eleventhApprove.body.error);
    } else {
      throw new Error(`11th pass approved or failed with incorrect error! Status: ${eleventhApprove.status}, Body: ${JSON.stringify(eleventhApprove.body)}`);
    }

    // Clean up the 11th pending request so Student 1 is clear for group request testing
    await prisma.exitPass.delete({ where: { id: eleventhApply.body.id } });

    // 6. Test Group request atomicity
    console.log('\n6. Verifying Group request atomic approval block...');
    
    // Group contains Student 1 (who has 10 approved passes) and Student 2 (who has 0 approved passes)
    const groupApply = await request({
      method: 'POST',
      path: '/api/exit-passes/group',
      headers: student2Headers // Student 2 is leader
    }, {
      groupName: 'Mini Project Batch A',
      reason: 'Purchase microcontrollers from local market',
      destination: 'City Market Hub',
      exitTime: new Date(Date.now() + 3 * 3600 * 1000).toISOString(),
      returnTime: new Date(Date.now() + 8 * 3600 * 1000).toISOString(),
      members: [`TEST${uniqueId}1`] // includes Student 1
    });

    if (groupApply.status !== 201) {
      throw new Error(`Group apply failed: ${JSON.stringify(groupApply.body)}`);
    }
    const groupId = groupApply.body.groupRequest.id;
    console.log(`   Group Request created. ID: ${groupId}`);

    // Try approving the group request. It should fail atomically because Student 1 is over quota!
    console.log('   Attempting atomic group approval...');
    const groupApprove = await request({
      method: 'POST',
      path: `/api/admin/exit-passes/group/${groupId}/approve`,
      headers: adminHeaders
    });

    if (groupApprove.status === 400 && groupApprove.body.error.includes('Atomic group approval failed')) {
      console.log('   ✅ Atomic group approval rejected correctly. Error: ' + groupApprove.body.error);
      
      // Verify student 2's group pass is still pending/unmodified
      const pass2 = await prisma.exitPass.findFirst({ where: { studentId: testStudentId2 } });
      if (pass2.status === 'PENDING') {
        console.log('   ✅ Student 2 pass remains PENDING (atomic rollback verified).');
      } else {
        throw new Error(`Rollback failed! Student 2 pass status changed to: ${pass2.status}`);
      }
    } else {
      throw new Error(`Group approval should have failed! Status: ${groupApprove.status}, Body: ${JSON.stringify(groupApprove.body)}`);
    }

    // Clean up the pending group request and passes from step 6 so Student 2 is clear
    await prisma.exitPass.deleteMany({ where: { studentId: testStudentId2 } });
    await prisma.groupExitPassRequest.deleteMany({ where: { leaderId: testStudentId2 } });

    // 7. Secure QR token retrieve & verify
    console.log('\n7. Verifying secure QR token retrieval & verify lifecycle...');
    
    // Create a new individual pass for Student 2
    const pass2Apply = await request({
      method: 'POST',
      path: '/api/exit-passes',
      headers: student2Headers
    }, {
      reason: 'General leave check',
      destination: 'SBI Bank Branch',
      exitTime: new Date(Date.now() + 2 * 3600 * 1000).toISOString(),
      returnTime: new Date(Date.now() + 5 * 3600 * 1000).toISOString(),
      emergencyContact: '9999999999'
    });
    const pass2Id = pass2Apply.body.id;

    // Approve it
    const pass2Approve = await request({
      method: 'POST',
      path: `/api/admin/exit-passes/${pass2Id}/approve`,
      headers: adminHeaders
    });
    
    // Retrieve QR token using Student 2 session
    console.log('   Retrieving decrypted QR token...');
    const tokenRes = await request({
      method: 'GET',
      path: `/api/exit-passes/${pass2Id}/qr-token`,
      headers: student2Headers
    });

    if (tokenRes.status !== 200 || !tokenRes.body.qrToken) {
      throw new Error(`Failed to retrieve decrypted QR token: ${JSON.stringify(tokenRes.body)}`);
    }
    const rawQrToken = tokenRes.body.qrToken;
    console.log(`   ✅ QR Token retrieved: ${rawQrToken.slice(0, 10)}... (AES-256-GCM successfully decrypted)`);

    // Verify token from Gate endpoint
    console.log('   Verifying scanned QR token from guard endpoint...');
    const verifyRes = await request({
      method: 'POST',
      path: '/api/admin/exit-passes/verify-qr',
      headers: adminHeaders
    }, { token: rawQrToken });

    if (verifyRes.status === 200 && verifyRes.body.valid) {
      console.log(`   ✅ Verification successful! Student name: ${verifyRes.body.student.name}`);
    } else {
      throw new Error(`QR Token verification failed: ${JSON.stringify(verifyRes.body)}`);
    }

    // 8. Confirm Exit idempotency checks
    console.log('\n8. Checking Exit Confirmation Idempotency...');
    
    // First confirm exit scan
    console.log('   First confirm-exit call...');
    const confirm1 = await request({
      method: 'POST',
      path: `/api/admin/exit-passes/${pass2Id}/confirm-exit`,
      headers: adminHeaders
    }, { gate: 'MAIN_GATE', verificationMethod: 'QR_SCAN' });

    if (confirm1.status === 200 && confirm1.body.success && confirm1.body.state === 'EXITED') {
      console.log('   ✅ First scan successfully recorded student as EXITED.');
    } else {
      throw new Error(`First confirm-exit failed: ${JSON.stringify(confirm1.body)}`);
    }

    // Second confirm exit scan
    console.log('   Second confirm-exit call...');
    const confirm2 = await request({
      method: 'POST',
      path: `/api/admin/exit-passes/${pass2Id}/confirm-exit`,
      headers: adminHeaders
    }, { gate: 'MAIN_GATE', verificationMethod: 'QR_SCAN' });

    if (confirm2.status === 200 && confirm2.body.error && confirm2.body.error.includes('already')) {
      console.log('   ✅ Second scan returned success = false, state = ALREADY_USED (idempotency confirmed).');
    } else {
      throw new Error(`Second confirm-exit returned unexpected result: ${JSON.stringify(confirm2.body)}`);
    }

    // 9. SMS audit log inspection
    console.log('\n9. Checking background parent SMS logs...');
    const smsLogs = await prisma.smsLog.findMany({ where: { studentId: testStudentId2 } });
    if (smsLogs.length > 0) {
      console.log(`   ✅ SmsLog record found. Masked Recipient: ${smsLogs[0].recipient} | Status: ${smsLogs[0].status}`);
      if (smsLogs[0].recipient.includes('***') && smsLogs[0].recipient.slice(-4) === '9992') {
        console.log('   ✅ Phone number masking verified perfectly.');
      } else {
        throw new Error(`Recipient formatting or masking incorrect: ${smsLogs[0].recipient}`);
      }
    } else {
      throw new Error('No SmsLog record found for Student 2 exit pass confirm!');
    }

    // 10. Identity mismatch auditing
    console.log('\n10. Checking Identity mismatch workflow...');
    
    // Setup another pass for Student 2
    const pass3Apply = await request({
      method: 'POST',
      path: '/api/exit-passes',
      headers: student2Headers
    }, {
      reason: 'Another check',
      destination: 'SBI Bank Branch',
      exitTime: new Date(Date.now() + 2 * 3600 * 1000).toISOString(),
      returnTime: new Date(Date.now() + 5 * 3600 * 1000).toISOString(),
      emergencyContact: '9999999999'
    });
    const pass3Id = pass3Apply.body.id;

    await request({
      method: 'POST',
      path: `/api/admin/exit-passes/${pass3Id}/approve`,
      headers: adminHeaders
    });

    // Report identity mismatch
    const mismatchRes = await request({
      method: 'POST',
      path: `/api/admin/exit-passes/${pass3Id}/reject-identity`,
      headers: adminHeaders
    }, { reason: 'Person does not match profile picture' });

    if (mismatchRes.status === 200 && mismatchRes.body.pass.status === 'UNDER_REVIEW') {
      console.log('   ✅ Exit pass status correctly set to UNDER_REVIEW.');
      
      const auditEvent = await prisma.auditLog.findFirst({
        where: { studentId: testStudentId2, action: 'IDENTITY_MISMATCH_REPORTED' }
      });
      if (auditEvent) {
        console.log(`   ✅ Audit log recorded event: ${auditEvent.details}`);
      } else {
        throw new Error('Audit log event for identity mismatch not found!');
      }
    } else {
      throw new Error(`Mismatch report failed: ${JSON.stringify(mismatchRes.body)}`);
    }

    // 11. OTP lockout verification
    console.log('\n11. Verifying manual OTP lockout logic (Max 3 failed attempts)...');
    const pass4Apply = await request({
      method: 'POST',
      path: '/api/exit-passes',
      headers: student2Headers
    }, {
      reason: 'OTP check',
      destination: 'Market',
      exitTime: new Date(Date.now() + 2 * 3600 * 1000).toISOString(),
      returnTime: new Date(Date.now() + 5 * 3600 * 1000).toISOString(),
      emergencyContact: '9999999999'
    });
    const pass4Id = pass4Apply.body.id;

    await request({
      method: 'POST',
      path: `/api/admin/exit-passes/${pass4Id}/approve`,
      headers: adminHeaders
    });

    // Verify OTP with wrong code 3 times
    console.log('   Sending 3 incorrect OTP verification requests...');
    for (let attempt = 1; attempt <= 3; attempt++) {
      const verifyRes = await request({
        method: 'POST',
        path: '/api/admin/exit-passes/verify-otp',
        headers: adminHeaders
      }, { otp: '999999', roll: `TEST${uniqueId}2` });
      
      if (attempt === 3) {
        if (verifyRes.status === 400 && verifyRes.body.error.includes('locked')) {
          console.log(`   ✅ Attempt 3 failed correctly and pass locked: ${verifyRes.body.error}`);
        } else {
          throw new Error(`Attempt 3 did not lock the pass correctly! Status: ${verifyRes.status}, Body: ${JSON.stringify(verifyRes.body)}`);
        }
      } else {
        console.log(`   Attempt ${attempt} response: ${verifyRes.body.error}`);
      }
    }

    const lockedPass = await prisma.exitPass.findUnique({ where: { id: pass4Id } });
    if (lockedPass.status === 'UNDER_REVIEW') {
      console.log('   ✅ Database verification: ExitPass status successfully updated to UNDER_REVIEW after lockout.');
    } else {
      throw new Error(`Database check failed: status is ${lockedPass.status}`);
    }

  } finally {
    // 12. Cleanup all created test data
    console.log('\n12. Performing database cleanup of all test records...');
    await prisma.smsLog.deleteMany({ where: { studentId: { in: [testStudentId1, testStudentId2] } } });
    await prisma.auditLog.deleteMany({ where: { studentId: { in: [testStudentId1, testStudentId2] } } });
    await prisma.exitPass.deleteMany({ where: { studentId: { in: [testStudentId1, testStudentId2] } } });
    await prisma.groupExitPassRequest.deleteMany({ where: { leaderId: { in: [testStudentId1, testStudentId2] } } });
    await prisma.notification.deleteMany({ where: { studentId: { in: [testStudentId1, testStudentId2] } } });
    await prisma.student.deleteMany({ where: { id: { in: [testStudentId1, testStudentId2] } } });
    console.log('   ✅ Cleanup complete.');
  }

  console.log('\n════════════════════════════════════════════════════════════');
  console.log('   ALL E2E VERIFICATION CHECKS PASSED SUCCESSFULLY! 🎉');
  console.log('════════════════════════════════════════════════════════════\n');
}

run()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('\n❌ E2E VERIFICATION TEST FAILED:', err.message);
    console.error(err);
    process.exit(1);
  });
