'use strict';
require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function check() {
  const placementStatuses = await prisma.placement.groupBy({ by: ['status'], _count: { id: true } });
  const announcementStatuses = await prisma.announcement.groupBy({ by: ['status'], _count: { id: true } });
  const exitPassStatuses = await prisma.exitPass.groupBy({ by: ['status'], _count: { id: true } });
  const feeStatuses = await prisma.fee.groupBy({ by: ['paymentStatus'], _count: { id: true } });
  const sampleStudents = await prisma.student.findMany({ take: 3, select: { userId: true, name: true, year: true, branch: true, semester: true } });
  const samplePlacements = await prisma.placement.findMany({ take: 3, select: { companyName: true, status: true, packageLpa: true } });
  
  console.log('=== PLACEMENT STATUSES ===');
  console.log(JSON.stringify(placementStatuses, null, 2));
  console.log('=== ANNOUNCEMENT STATUSES ===');
  console.log(JSON.stringify(announcementStatuses, null, 2));
  console.log('=== EXIT PASS STATUSES ===');
  console.log(JSON.stringify(exitPassStatuses, null, 2));
  console.log('=== FEE STATUSES ===');
  console.log(JSON.stringify(feeStatuses, null, 2));
  console.log('=== SAMPLE STUDENTS ===');
  console.log(JSON.stringify(sampleStudents, null, 2));
  console.log('=== SAMPLE PLACEMENTS ===');
  console.log(JSON.stringify(samplePlacements, null, 2));
  
  await prisma.$disconnect();
}

check().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
