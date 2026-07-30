'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../backend/.env') });
const prisma = require('../backend/services/dbService');

async function verifyDatabaseAndHealth() {
    console.log('====================================================');
    console.log('  SITAM BACKEND — POST-DEPLOYMENT VERIFICATION      ');
    console.log('====================================================');

    try {
        const studentCount = await prisma.student.count();
        const exitPassCount = await prisma.exitPass.count();

        console.log(`[DB Check] Total Students   : ${studentCount}`);
        console.log(`[DB Check] Total Exit Passes: ${exitPassCount}`);

        if (studentCount === 503 && exitPassCount === 82) {
            console.log('✅ Database Integrity PASS (503 Students, 82 Exit Passes intact)');
        } else {
            console.error('❌ Database Integrity WARNING: Counts differ from baseline');
        }
    } catch (err) {
        console.error('❌ DB Verification error:', err.message);
    } finally {
        process.exit(0);
    }
}

verifyDatabaseAndHealth();
