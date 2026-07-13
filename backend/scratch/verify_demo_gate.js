'use strict';

const { spawn, execSync } = require('child_process');
const axios = require('axios');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '../.env') });

const PORT = process.env.PORT || 3001;
const BASE_URL = `http://localhost:${PORT}`;

async function runDbChecks() {
    const results = {
        database: false,
        students: 0,
        faculty: 0,
        courses: 0,
        attendance: false,
        marks: false,
        fees: false,
        notifications: false,
        exitPasses: false,
        placements: false,
        lms: false
    };

    try {
        await prisma.$queryRaw`SELECT 1`;
        results.database = true;
    } catch (err) {
        console.error('❌ Database connection failed:', err.message);
        return results;
    }

    try {
        const studentCount = await prisma.student.count();
        results.students = studentCount;

        const facultyCount = await prisma.faculty.count();
        results.faculty = facultyCount;

        const courseCount = await prisma.course.count();
        results.courses = courseCount;

        const attendanceCount = await prisma.attendanceRecord.count();
        results.attendance = attendanceCount > 0;

        const marksCount = await prisma.markRecord.count();
        results.marks = marksCount > 0;

        const feesCount = await prisma.fee.count();
        results.fees = feesCount > 0;

        const notificationCount = await prisma.notification.count();
        results.notifications = notificationCount >= 200;

        const exitPassCount = await prisma.exitPass.count();
        results.exitPasses = exitPassCount >= 20;

        const placementCount = await prisma.placement.count();
        results.placements = placementCount >= 20;

        const enrollmentCount = await prisma.courseEnrollment.count();
        const progressCount = await prisma.courseProgress.count();
        const assignmentCount = await prisma.lmsAssignment.count();
        const quizCount = await prisma.lmsQuiz.count();
        results.lms = (enrollmentCount > 0 && progressCount > 0 && assignmentCount > 0 && quizCount > 0);
    } catch (err) {
        console.error('❌ Failed to retrieve database records:', err.message);
    }

    return results;
}

function runAutoFix() {
    console.log('\n🛠️  Executing Automatic Fix: Re-seeding database...');
    try {
        execSync('node scripts/seed-demo.js', { cwd: path.join(__dirname, '..'), stdio: 'inherit' });
        console.log('✅ Re-seeding complete.');
    } catch (err) {
        console.error('❌ Failed to run seed-demo.js:', err.message);
    }
}

async function isServerRunning() {
    try {
        const res = await axios.get(`${BASE_URL}/api/health`, { timeout: 1000 });
        return res.status === 200;
    } catch (err) {
        return false;
    }
}

async function verifyGate() {
    console.log('========================================');
    console.log('SITAM SMART ERP DEMO GATE VERIFICATION');
    console.log('========================================\n');

    let dbResults = await runDbChecks();

    // Auto-fix if any check fails
    const needsFix = !dbResults.database ||
        dbResults.students < 500 ||
        dbResults.faculty < 20 ||
        dbResults.courses < 40 ||
        !dbResults.attendance ||
        !dbResults.marks ||
        !dbResults.fees ||
        !dbResults.notifications ||
        !dbResults.exitPasses ||
        !dbResults.placements ||
        !dbResults.lms;

    if (needsFix) {
        console.log('⚠️  Some database gate criteria are not met.');
        runAutoFix();
        console.log('🔍 Re-verifying database criteria...');
        dbResults = await runDbChecks();
    }

    // Now start the server if not running
    let spawnedProcess = null;
    const alreadyRunning = await isServerRunning();

    if (!alreadyRunning) {
        console.log('\n🚀 Server is not running. Starting backend server on port ' + PORT + '...');
        let serverLogs = '';
        spawnedProcess = spawn('node', ['server.js'], {
            cwd: path.join(__dirname, '..'),
            env: { ...process.env, DISABLE_SCHEDULERS: 'true' }
        });

        if (spawnedProcess.stdout) {
            spawnedProcess.stdout.on('data', (data) => {
                serverLogs += data.toString();
            });
        }
        if (spawnedProcess.stderr) {
            spawnedProcess.stderr.on('data', (data) => {
                serverLogs += data.toString();
            });
        }

        // Wait for server to boot by polling the health endpoint (up to 45 seconds)
        let serverReady = false;
        for (let i = 0; i < 90; i++) {
            await new Promise(resolve => setTimeout(resolve, 500));
            if (await isServerRunning()) {
                serverReady = true;
                break;
            }
        }

        if (!serverReady) {
            console.error('❌ Failed to start backend server or server did not respond within timeout.');
            console.error('\n--- Spawned Server Logs ---');
            console.error(serverLogs);
            console.error('---------------------------');
            if (spawnedProcess) spawnedProcess.kill();
            process.exit(1);
        }
        console.log('✅ Server started successfully.');
    } else {
        console.log('\n🔗 Connected to already running backend server on port ' + PORT + '.');
    }

    let apiHealthPass = false;
    let demoStatusPass = false;

    // Verify API Health
    try {
        const res = await axios.get(`${BASE_URL}/api/health`);
        if (res.status === 200 && res.data.status === 'ok') {
            apiHealthPass = true;
        }
    } catch (err) {
        console.error('❌ API Health check failed:', err.message);
    }

    // Verify Demo Status
    try {
        const res = await axios.get(`${BASE_URL}/api/demo/status`);
        if (res.status === 200 && res.data.status === 'READY FOR DEMO') {
            demoStatusPass = true;
        } else {
            console.error('❌ Demo Status check failed. Response:', res.data);
        }
    } catch (err) {
        console.error('❌ Demo Status API call failed:', err.message);
    }

    // Clean up spawned process if we started it
    if (spawnedProcess) {
        console.log('\n🛑 Stopping spawned backend server...');
        spawnedProcess.kill();
    }

    // Final report
    const dbStatus = dbResults.database ? 'PASS' : 'FAIL';
    const studentsStatus = dbResults.students >= 500 ? `PASS (${dbResults.students})` : `FAIL (${dbResults.students})`;
    const facultyStatus = dbResults.faculty >= 20 ? `PASS (${dbResults.faculty})` : `FAIL (${dbResults.faculty})`;
    const coursesStatus = dbResults.courses >= 40 ? `PASS (${dbResults.courses})` : `FAIL (${dbResults.courses})`;
    const attendanceStatus = dbResults.attendance ? 'PASS' : 'FAIL';
    const marksStatus = dbResults.marks ? 'PASS' : 'FAIL';
    const feesStatus = dbResults.fees ? 'PASS' : 'FAIL';
    const notificationsStatus = dbResults.notifications ? 'PASS' : 'FAIL';
    const exitPassesStatus = dbResults.exitPasses ? 'PASS' : 'FAIL';
    const placementsStatus = dbResults.placements ? 'PASS' : 'FAIL';
    const lmsStatus = dbResults.lms ? 'PASS' : 'FAIL';
    const healthStatus = apiHealthPass ? 'PASS' : 'FAIL';
    const demoStatusVal = demoStatusPass ? 'PASS' : 'FAIL';

    const overallPass = dbResults.database &&
        dbResults.students >= 500 &&
        dbResults.faculty >= 20 &&
        dbResults.courses >= 40 &&
        dbResults.attendance &&
        dbResults.marks &&
        dbResults.fees &&
        dbResults.notifications &&
        dbResults.exitPasses &&
        dbResults.placements &&
        dbResults.lms &&
        apiHealthPass &&
        demoStatusPass;

    console.log('\n========================================');
    console.log('SITAM SMART ERP DEMO GATE');
    console.log('========================================');
    console.log('Database ............ ' + dbStatus);
    console.log('Students ............ ' + studentsStatus);
    console.log('Faculty ............. ' + facultyStatus);
    console.log('Courses ............. ' + coursesStatus);
    console.log('Attendance .......... ' + attendanceStatus);
    console.log('Marks ............... ' + marksStatus);
    console.log('Fees ................ ' + feesStatus);
    console.log('Notifications ....... ' + notificationsStatus);
    console.log('Exit Passes ......... ' + exitPassesStatus);
    console.log('Placements .......... ' + placementsStatus);
    console.log('LMS ................. ' + lmsStatus);
    console.log('API Health .......... ' + healthStatus);
    console.log('Demo Status ......... ' + demoStatusVal);
    console.log('========================================');
    console.log('OVERALL STATUS');
    console.log(overallPass ? 'READY FOR DEMO' : 'NOT READY');
    console.log('========================================\n');

    await prisma.$disconnect();

    if (overallPass) {
        process.exit(0);
    } else {
        process.exit(1);
    }
}

verifyGate();
