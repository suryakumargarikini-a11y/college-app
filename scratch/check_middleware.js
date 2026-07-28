process.env.ADMIN_JWT_SECRET = 'a_very_long_and_secure_jwt_secret_32_chars_plus';
process.env.ADMIN_PASSWORD_SALT = 'a_very_secure_admin_password_salt_pepper_123';

const modules = [
  { name: 'errorHandler', path: '../backend/middleware/errorHandler', check: m => typeof m.errorHandler === 'function' && typeof m.responseStandardizer === 'function' },
  { name: 'correlationMiddleware', path: '../backend/middleware/correlationMiddleware', check: m => typeof m === 'function' },
  { name: 'requestId', path: '../backend/middleware/requestId', check: m => typeof m === 'function' },
  { name: 'sreRoutes', path: '../backend/routes/sre', check: m => typeof m === 'function' },
  { name: 'browserPoolRoutes', path: '../backend/routes/browserPool', check: m => typeof m === 'function' },
  { name: 'authRoutes', path: '../backend/routes/auth', check: m => typeof m === 'function' },
  { name: 'profileRoutes', path: '../backend/routes/profile', check: m => typeof m === 'function' },
  { name: 'marksRoutes', path: '../backend/routes/marks', check: m => typeof m === 'function' },
  { name: 'attendanceRoutes', path: '../backend/routes/attendance', check: m => typeof m === 'function' },
  { name: 'feesRoutes', path: '../backend/routes/fees', check: m => typeof m === 'function' },
  { name: 'assignmentsRoutes', path: '../backend/routes/assignments', check: m => typeof m === 'function' },
  { name: 'timetableRoutes', path: '../backend/routes/timetable', check: m => typeof m === 'function' },
  { name: 'syllabusRoutes', path: '../backend/routes/syllabus', check: m => typeof m === 'function' },
  { name: 'syncRoutes', path: '../backend/routes/sync', check: m => typeof m === 'function' },
  { name: 'studentRoutes', path: '../backend/routes/student', check: m => typeof m === 'function' },
  { name: 'notificationsRoutes', path: '../backend/routes/notifications', check: m => typeof m === 'function' },
  { name: 'examsRoutes', path: '../backend/routes/exams', check: m => typeof m === 'function' },
  { name: 'lmsRoutes', path: '../backend/routes/lms', check: m => typeof m === 'function' },
  { name: 'libraryRoutes', path: '../backend/routes/library', check: m => typeof m === 'function' },
  { name: 'maintenanceMiddleware', path: '../backend/middleware/maintenance', check: m => typeof m === 'function' },
  { name: 'adminRoutes', path: '../backend/routes/admin/index', check: m => typeof m === 'function' },
  { name: 'demoRoutes', path: '../backend/routes/demo', check: m => typeof m === 'function' },
  { name: 'announcementsRoutes', path: '../backend/routes/announcements', check: m => typeof m === 'function' },
  { name: 'placementsRoutes', path: '../backend/routes/placements', check: m => typeof m === 'function' },
  { name: 'feeNoticesRoutes', path: '../backend/routes/feeNotices', check: m => typeof m === 'function' },
  { name: 'exitPassesRoutes', path: '../backend/routes/exitPasses', check: m => typeof m === 'function' },
  { name: 'surveysRoutes', path: '../backend/routes/surveys', check: m => typeof m === 'function' },
  { name: 'helpDeskRoutes', path: '../backend/routes/helpDesk', check: m => typeof m === 'function' },
  { name: 'lostFoundRoutes', path: '../backend/routes/lostFound', check: m => typeof m === 'function' },
];

modules.forEach(mod => {
  try {
    const loaded = require(mod.path);
    const valid = mod.check(loaded);
    console.log(`[CHECK] ${mod.name}: type=${typeof loaded} | valid=${valid}`);
  } catch (e) {
    console.error(`[CHECK-FAIL] ${mod.name}: EXCEPTION -> ${e.message}`, e.stack);
  }
});
