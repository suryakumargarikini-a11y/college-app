'use strict';
require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function check() {
  const [sc, fc, cc, dc, ac, mc, fee, tp, notif, ep, ht, ann, surv, lf, ce, cp] = await Promise.all([
    prisma.student.count(),
    prisma.faculty.count().catch(() => 0),
    prisma.course.count().catch(() => 0),
    prisma.department.count().catch(() => 0),
    prisma.attendanceRecord.count(),
    prisma.markRecord.count(),
    prisma.fee.count(),
    prisma.placement.count(),
    prisma.notification.count(),
    prisma.exitPass.count(),
    prisma.helpTicket.count().catch(() => 0),
    prisma.announcement.count(),
    prisma.survey.count().catch(() => 0),
    prisma.lostFoundItem.count().catch(() => 0),
    prisma.courseEnrollment.count().catch(() => 0),
    prisma.courseProgress.count().catch(() => 0),
  ]);
  console.log(JSON.stringify({
    students: sc, faculty: fc, courses: cc, departments: dc,
    attendance: ac, marks: mc, fees: fee, placements: tp,
    notifications: notif, exitPasses: ep, helpTickets: ht, announcements: ann,
    surveys: surv, lostFound: lf, courseEnrollments: ce, courseProgress: cp
  }, null, 2));
  await prisma.$disconnect();
}

check().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
