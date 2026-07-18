'use strict';
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8080;
const PASS = 'webcap';
const ADMIN_PASS = 'Admin@SITAM2024';
const FACULTY_PASS = process.env.SEED_FACULTY_PASS || 'Faculty@1234-Dev';

function request(opts, body = null) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const data = body ? (Buffer.isBuffer(body) ? body : JSON.stringify(body)) : null;
    const isJson = body && !Buffer.isBuffer(body);
    
    const req = http.request({
      hostname: 'localhost',
      port: PORT,
      method: opts.method || 'GET',
      path: opts.path,
      headers: {
        ...(isJson ? { 'Content-Type': 'application/json' } : {}),
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
        resolve({ status: res.statusCode, headers: res.headers, body: parsed, raw, ms });
      });
    });
    
    req.on('error', reject);
    req.setTimeout(10000, () => req.destroy(new Error('timeout')));
    if (data) req.write(data);
    req.end();
  });
}

async function run() {
  console.log('════════════════════════════════════════════════════════════');
  console.log('   E-LIBRARY MODULE ACCEPTANCE E2E VERIFICATION TEST');
  console.log('════════════════════════════════════════════════════════════\n');

  // 1. Get student profiles from DB to derive target tags
  console.log('1. Fetching test students from database...');
  const studentA = await prisma.student.findUnique({ where: { userId: '25B61A4532' } });
  const studentB = await prisma.student.findUnique({ where: { userId: '25B61A0596' } });
  
  if (!studentA || !studentB) {
    throw new Error('Test students (25B61A4532 or 25B61A0596) not found in database. Run profile scraper first.');
  }
  
  console.log(`   Student A: ${studentA.name} (${studentA.userId})`);
  console.log(`     Branch: ${studentA.branch} | Sem: ${studentA.semester} | Sec: ${studentA.section} | Year: ${studentA.year || studentA.academicYear}`);
  console.log(`   Student B: ${studentB.name} (${studentB.userId})`);
  console.log(`     Branch: ${studentB.branch} | Sem: ${studentB.semester} | Sec: ${studentB.section} | Year: ${studentB.year || studentB.academicYear}\n`);

  // 2. Perform Logins
  console.log('2. Verifying logins...');
  
  // Admin Login
  const loginAdmin = await request({ method: 'POST', path: '/api/admin/auth/login' }, { email: 'admin@sitamecap.co.in', password: ADMIN_PASS });
  if (loginAdmin.status !== 200) throw new Error(`Admin login failed: ${JSON.stringify(loginAdmin.body)}`);
  const adminToken = loginAdmin.body.token;
  console.log('   ✅ Admin logged in successfully.');

  // Faculty Login
  const loginFaculty = await request({ method: 'POST', path: '/api/admin/auth/login' }, { email: 'faculty@sitamecap.co.in', password: FACULTY_PASS });
  if (loginFaculty.status !== 200) throw new Error(`Faculty login failed: ${JSON.stringify(loginFaculty.body)}`);
  const facultyToken = loginFaculty.body.token;
  console.log('   ✅ Faculty logged in successfully.');

  // Student A Login
  const loginStudentA = await request({ method: 'POST', path: '/api/auth/login' }, { userId: studentA.userId, password: PASS });
  if (loginStudentA.status !== 200) throw new Error(`Student A login failed: ${JSON.stringify(loginStudentA.body)}`);
  const studentAToken = loginStudentA.body.token || loginStudentA.body.data?.token;
  console.log('   ✅ Student A logged in successfully.');

  // Student B Login
  const loginStudentB = await request({ method: 'POST', path: '/api/auth/login' }, { userId: studentB.userId, password: PASS });
  if (loginStudentB.status !== 200) throw new Error(`Student B login failed: ${JSON.stringify(loginStudentB.body)}`);
  const studentBToken = loginStudentB.body.token || loginStudentB.body.data?.token;
  console.log('   ✅ Student B logged in successfully.\n');

  // 3. Verify student upload rejection
  console.log('3. Verifying student upload rejection...');
  const fakeFile = Buffer.from('%PDF-1.4 test file content...');
  const studentUpload = await request({
    method: 'POST',
    path: '/api/library/admin/materials?title=Hack&subject=Intrusion&category=NOTES',
    headers: {
      'Authorization': `Bearer ${studentAToken}`,
      'Content-Type': 'application/pdf',
      'X-File-Name': 'hack.pdf'
    }
  }, fakeFile);
  if (studentUpload.status === 401 || studentUpload.status === 403) {
    console.log('   ✅ Student upload rejected correctly (HTTP ' + studentUpload.status + ').');
  } else {
    throw new Error(`Security breach: student upload succeeded or returned unexpected status: ${studentUpload.status}`);
  }
  console.log('');

  // 4. Faculty and Admin Uploads with targeting
  console.log('4. Performing Faculty and Admin uploads...');
  
  // Material A: Targeted exactly to Student A's attributes
  const metaA = {
    title: 'E2E Test Note A',
    description: 'This note is targeted for Student A',
    subject: 'E2E-TEST-A',
    category: 'NOTES',
    branch: studentA.branch,
    semester: studentA.semester,
    section: studentA.section,
    academicYear: studentA.year || studentA.academicYear
  };
  
  console.log(`   Faculty uploading Material A (targeted to Student A's class)...`);
  const uploadA = await request({
    method: 'POST',
    path: `/api/library/admin/materials?${new URLSearchParams(metaA)}`,
    headers: {
      'Authorization': `Bearer ${facultyToken}`,
      'Content-Type': 'application/pdf',
      'X-File-Name': 'noteA.pdf'
    }
  }, fakeFile);
  if (uploadA.status !== 201) throw new Error(`Faculty upload failed: ${JSON.stringify(uploadA.body)}`);
  const materialA = uploadA.body.material;
  console.log(`   ✅ Uploaded successfully. ID: ${materialA.id}`);

  // Material B: Targeted to Student B's attributes (which must differ from Student A)
  // Let's ensure it has a different branch or section or semester to differ from Student A
  let branchB = studentB.branch;
  let sectionB = studentB.section;
  if (studentA.branch === studentB.branch && studentA.semester === studentB.semester && studentA.section === studentB.section) {
    // If they have the exact same class attributes, force Material B to differ by branch or section
    branchB = studentA.branch === 'COMPUTER SCIENCE ENGINEERING' ? 'ELECTRONICS & COMMUNICATION ENGINEERING' : 'COMPUTER SCIENCE ENGINEERING';
    sectionB = studentA.section === 'A' ? 'B' : 'A';
  }
  
  const metaB = {
    title: 'E2E Test Note B',
    description: 'This note is targeted for Student B',
    subject: 'E2E-TEST-B',
    category: 'ASSIGNMENT',
    branch: branchB,
    semester: studentB.semester,
    section: sectionB,
    academicYear: studentB.year || studentB.academicYear
  };

  console.log(`   Admin uploading Material B (targeted to different class)...`);
  const uploadB = await request({
    method: 'POST',
    path: `/api/library/admin/materials?${new URLSearchParams(metaB)}`,
    headers: {
      'Authorization': `Bearer ${adminToken}`,
      'Content-Type': 'application/pdf',
      'X-File-Name': 'noteB.pdf'
    }
  }, fakeFile);
  if (uploadB.status !== 201) throw new Error(`Admin upload failed: ${JSON.stringify(uploadB.body)}`);
  const materialB = uploadB.body.material;
  console.log(`   ✅ Uploaded successfully. ID: ${materialB.id}\n`);

  // 5. Verify Student A Targeting visibility
  console.log('5. Verifying Student A targeting visibility...');
  const listA = await request({
    method: 'GET',
    path: '/api/library/materials',
    headers: { 'Authorization': `Bearer ${studentAToken}` }
  });
  
  if (listA.status !== 200) throw new Error(`Failed to list materials: ${JSON.stringify(listA.body)}`);
  const materialsForA = listA.body;
  const hasA = materialsForA.some(m => m.id === materialA.id);
  const hasB = materialsForA.some(m => m.id === materialB.id);
  
  if (hasA && !hasB) {
    console.log('   ✅ Student A CAN see Material A (eligible).');
    console.log('   ✅ Student A CANNOT see Material B (ineligible).');
  } else {
    throw new Error(`Targeting failure. Student A list contains: hasA=${hasA}, hasB=${hasB}`);
  }
  console.log('');

  // 6. Verify direct access protection
  console.log('6. Verifying direct access protection...');
  
  // Student A requests Material A (authorized)
  const serveA = await request({
    method: 'GET',
    path: `/api/library/materials/${materialA.id}/content`,
    headers: { 'Authorization': `Bearer ${studentAToken}` }
  });
  if (serveA.status === 200) {
    console.log('   ✅ Student A authorized direct fetch of Material A (HTTP 200).');
  } else {
    throw new Error(`Access denied for eligible student: HTTP ${serveA.status}`);
  }

  // Student A requests Material B (unauthorized)
  const serveB = await request({
    method: 'GET',
    path: `/api/library/materials/${materialB.id}/content`,
    headers: { 'Authorization': `Bearer ${studentAToken}` }
  });
  if (serveB.status === 403) {
    console.log('   ✅ Student A denied direct fetch of Material B (HTTP 403 Forbidden).');
  } else {
    throw new Error(`Security breach: ineligible student accessed file directly (HTTP ${serveB.status})`);
  }

  // Unauthenticated request
  const serveUnauth = await request({
    method: 'GET',
    path: `/api/library/materials/${materialA.id}/content`
  });
  if (serveUnauth.status === 401) {
    console.log('   ✅ Unauthenticated direct fetch rejected (HTTP 401).');
  } else {
    throw new Error(`Security breach: unauthenticated user accessed file directly (HTTP ${serveUnauth.status})`);
  }
  console.log('');

  // 7. Verify Replace File
  console.log('7. Verifying Replace File...');
  const newFakeFile = Buffer.from('%PDF-1.4 updated file content (larger file size placeholder)...');
  const replaceRes = await request({
    method: 'PUT',
    path: `/api/library/admin/materials/${materialA.id}/file`,
    headers: {
      'Authorization': `Bearer ${facultyToken}`,
      'Content-Type': 'application/pdf',
      'X-File-Name': 'noteA_updated.pdf'
    }
  }, newFakeFile);
  
  if (replaceRes.status !== 200) throw new Error(`Replace file failed: ${JSON.stringify(replaceRes.body)}`);
  console.log('   ✅ File replaced successfully.');
  
  // Verify DB record updated
  const updatedMaterialA = await prisma.libraryMaterial.findUnique({ where: { id: materialA.id } });
  if (updatedMaterialA.fileSize === newFakeFile.length && updatedMaterialA.originalFileName === 'noteA_updated.pdf') {
    console.log(`   ✅ DB record verified: size=${updatedMaterialA.fileSize} bytes, name="${updatedMaterialA.originalFileName}"`);
  } else {
    throw new Error('Replacement mismatch in DB record');
  }
  console.log('');

  // 8. Verify activity tracking (views & downloads)
  console.log('8. Verifying activity tracking...');
  
  // Wait a brief moment for database writes
  await new Promise(r => setTimeout(r, 500));
  
  const viewRecord = await prisma.libraryView.findUnique({
    where: { studentId_materialId: { studentId: studentA.id, materialId: materialA.id } }
  });
  if (viewRecord) {
    console.log('   ✅ View record logged: ' + JSON.stringify(viewRecord));
  } else {
    throw new Error('LibraryView record not created');
  }

  // Trigger download call
  const downloadCall = await request({
    method: 'GET',
    path: `/api/library/materials/${materialA.id}/content?download=true`,
    headers: { 'Authorization': `Bearer ${studentAToken}` }
  });
  if (downloadCall.status !== 200) throw new Error('Download call failed');
  
  await new Promise(r => setTimeout(r, 500));
  
  const downloadRecord = await prisma.libraryDownload.findUnique({
    where: { studentId_materialId: { studentId: studentA.id, materialId: materialA.id } }
  });
  if (downloadRecord) {
    console.log('   ✅ Download record logged: ' + JSON.stringify(downloadRecord));
  } else {
    throw new Error('LibraryDownload record not created');
  }
  console.log('');

  // 9. Verify Targeted Notifications
  console.log('9. Verifying targeted notifications...');
  
  // Material A was targeted to Student A's class.
  // Wait for setImmediate notifications task to finish
  await new Promise(r => setTimeout(r, 1000));
  
  const notificationsForA = await prisma.notification.findMany({
    where: { studentId: studentA.id, type: 'library' }
  });
  const hasNotificationA = notificationsForA.some(n => n.title.includes(materialA.title));
  
  const notificationsForB = await prisma.notification.findMany({
    where: { studentId: studentB.id, type: 'library' }
  });
  const hasNotificationB = notificationsForB.some(n => n.title.includes(materialA.title));
  
  if (hasNotificationA && !hasNotificationB) {
    console.log('   ✅ Student A received a targeted library notification.');
    console.log('   ✅ Student B did NOT receive the notification (ineligible).');
  } else {
    throw new Error(`Notification leak or delivery error: Student A=${hasNotificationA}, Student B=${hasNotificationB}`);
  }
  console.log('');

  // 10. Cleanup test data
  console.log('10. Cleaning up test data...');
  
  // Archive Material A first
  await request({
    method: 'POST',
    path: `/api/library/admin/materials/${materialA.id}/archive`,
    headers: { 'Authorization': `Bearer ${adminToken}` }
  });
  
  // Delete records from database (cascades views/downloads/notifications if any relationships exist, else we delete them manually)
  await prisma.libraryView.deleteMany({ where: { materialId: { in: [materialA.id, materialB.id] } } });
  await prisma.libraryDownload.deleteMany({ where: { materialId: { in: [materialA.id, materialB.id] } } });
  
  // Delete notification entries
  await prisma.notification.deleteMany({
    where: { title: { contains: 'E2E Test Note' } }
  });
  
  // Delete materials
  await prisma.libraryMaterial.delete({ where: { id: materialA.id } });
  await prisma.libraryMaterial.delete({ where: { id: materialB.id } });
  
  // Delete local files
  const fileA = path.join(__dirname, '..', 'uploads', 'library', updatedMaterialA.fileName);
  const fileB = path.join(__dirname, '..', 'uploads', 'library', materialB.fileName);
  if (fs.existsSync(fileA)) fs.unlinkSync(fileA);
  if (fs.existsSync(fileB)) fs.unlinkSync(fileB);
  
  console.log('   ✅ Cleaned up all database records and storage files.');
  console.log('\n════════════════════════════════════════════════════════════');
  console.log('   ALL E-LIBRARY E2E ACCEPTANCE TESTS PASSED SUCCESSFULLY! 🎉');
  console.log('════════════════════════════════════════════════════════════');
}

run()
  .then(() => {
    process.exit(0);
  })
  .catch(err => {
    console.error('\n❌ E2E Verification Failed:', err.stack || err);
    process.exit(1);
  })
  .finally(() => {
    prisma.$disconnect();
  });
