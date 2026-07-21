'use strict';

const express = require('express');
const router = express.Router();
const prisma = require('../services/dbService');
const browserPool = require('../services/browserPool');
const logger = require('../services/logger');

// GET /api/demo/status
router.get('/status', async (req, res) => {
    let dbStatus = 'FAILED';
    const reasons = [];

    // 1. Database Check
    try {
        await prisma.$queryRaw`SELECT 1`;
        dbStatus = 'CONNECTED';
    } catch (dbErr) {
        logger.error(`[DemoStatus] Database check failed: ${dbErr.message}`);
        reasons.push(`Database connection failed: ${dbErr.message}`);
    }

    const isDemo = process.env.DEMO_MODE === 'true';
    const providerName = isDemo ? 'DemoProvider' : 'ProductionProvider';

    let studentCount = 0;
    let facultyCount = 0;
    let courseCount = 0;
    let notificationCount = 0;
    let exitPassCount = 0;
    let placementCount = 0;
    let lmsStatus = 'NOT READY';
    let analyticsStatus = 'NOT READY';
    let bpStatus = 'READY';

    if (dbStatus === 'CONNECTED') {
        try {
            studentCount = await prisma.student.count();
            facultyCount = await prisma.faculty.count();
            courseCount = await prisma.course.count();
            notificationCount = await prisma.notification.count();
            exitPassCount = await prisma.exitPass.count();
            placementCount = await prisma.placement.count();

            // Check LMS availability
            if (typeof prisma.courseProgress !== 'undefined' && typeof prisma.courseEnrollment !== 'undefined') {
                const courseProgressCount = await prisma.courseProgress.count();
                const courseEnrollmentCount = await prisma.courseEnrollment.count();
                if (courseEnrollmentCount > 0 && courseProgressCount > 0) {
                    lmsStatus = 'READY';
                } else {
                    reasons.push(`LMS not ready: Enrollments = ${courseEnrollmentCount}, Progress records = ${courseProgressCount}`);
                }
            } else {
                lmsStatus = 'SKIPPED';
            }

            // Check Analytics availability
            const markCount = await prisma.markRecord.count();
            const attendanceCount = await prisma.attendanceRecord.count();
            if (markCount > 0 && attendanceCount > 0) {
                analyticsStatus = 'READY';
            } else {
                reasons.push(`Analytics not ready: Marks = ${markCount}, Attendance = ${attendanceCount}`);
            }

            // Threshold checks
            if (studentCount < 500) {
                reasons.push(`Student count is ${studentCount}, expected at least 500.`);
            }
            if (facultyCount < 20) {
                reasons.push(`Faculty count is ${facultyCount}, expected at least 20.`);
            }
            if (courseCount < 40) {
                reasons.push(`Course count is ${courseCount}, expected at least 40.`);
            }
            if (notificationCount < 200) {
                reasons.push(`Notification count is ${notificationCount}, expected at least 200.`);
            }
            if (exitPassCount < 20) {
                reasons.push(`Exit Pass count is ${exitPassCount}, expected at least 20.`);
            }
            if (placementCount < 20) {
                reasons.push(`Placement count is ${placementCount}, expected at least 20.`);
            }

        } catch (dbReadErr) {
            logger.error(`[DemoStatus] Database read failed: ${dbReadErr.message}`);
            reasons.push(`Database read error: ${dbReadErr.message}`);
        }
    }

    // 2. Browser Pool Check (only when DEMO_MODE=false)
    if (!isDemo) {
        try {
            const poolStatus = browserPool.getStatus();
            if (poolStatus && poolStatus.active !== undefined) {
                bpStatus = 'READY';
            } else {
                bpStatus = 'FAILED';
                reasons.push('BrowserPool status not healthy or not initialized.');
            }
        } catch (poolErr) {
            bpStatus = 'FAILED';
            reasons.push(`BrowserPool error: ${poolErr.message}`);
        }
    } else {
        bpStatus = 'READY'; // Bypass in DEMO_MODE
    }

    const allReady = reasons.length === 0 && dbStatus === 'CONNECTED';
    const status = allReady ? 'READY FOR DEMO' : 'NOT READY';

    const responsePayload = {
        status,
        database: dbStatus,
        provider: providerName,
        demoDataset: {
            students: studentCount,
            faculty: facultyCount,
            courses: courseCount,
            notifications: notificationCount,
            exitPasses: exitPassCount,
            placements: placementCount
        },
        services: {
            browserPool: bpStatus,
            notifications: notificationCount > 0 ? 'READY' : 'NOT READY',
            analytics: analyticsStatus,
            lms: lmsStatus
        }
    };

    if (!allReady) {
        responsePayload.reasons = reasons;
    }

    res.status(allReady ? 200 : 503).json(responsePayload);
});

module.exports = router;
