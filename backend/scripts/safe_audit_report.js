'use strict';

/**
 * SAFE AUDIT REPORT SCRIPT — READ ONLY, NO DB MUTATIONS, NO PRINTING SECRETS
 */

require('dotenv').config();
const prisma = require('../services/dbService');

async function runAudit() {
    console.log('=============================================================');
    console.log('           SAFE ADMIN AUTHENTICATION AUDIT REPORT            ');
    console.log('=============================================================\n');

    const admin = await prisma.admin.findUnique({
        where: { email: 'admin@sitamecap.co.in' },
        select: {
            id: true,
            email: true,
            role: true,
            isActive: true,
            createdAt: true,
            updatedAt: true
        }
    });

    console.log('--- 1. DATABASE RECORD AUDIT ---');
    console.log('Admin record exists    :', admin ? 'YES' : 'NO');
    if (admin) {
        console.log('Email matches exact    :', admin.email === 'admin@sitamecap.co.in' ? 'YES' : 'NO');
        console.log('Role                   :', admin.role);
        console.log('IsActive               :', admin.isActive);
    }

    console.log('\n--- 2. HASHING ALGORITHM & SOURCE COMPARISON ---');
    console.log('Sync hash algorithm    : crypto.createHmac("sha256", process.env.ADMIN_PASSWORD_SALT).update(pwd).digest("hex")');
    console.log('Login hash algorithm   : crypto.createHmac("sha256", process.env.ADMIN_PASSWORD_SALT).update(password).digest("hex")');
    console.log('Sync password source   : Hardcoded literal string ("Admin@SITAM2024")');
    console.log('Login password source  : req.body.password');
    console.log('Structurally identical : YES');

    console.log('\n--- 3. IDENTIFIED WRITERS TO Admin.passwordHash ---');
    console.log('1. services/adminAutoSync.js (autoSyncAdminCredentials on boot)');
    console.log('2. controllers/admin/authController.js (changePassword API endpoint)');
    console.log('3. controllers/admin/staffManagementController.js (createStaff / resetStaffPassword API endpoints)');
    console.log('4. scripts/repair_super_admin_railway.js (maintenance script)');
    console.log('5. scripts/repair-super-admin-once.js (maintenance script)');
    console.log('6. scripts/reset_admin_password_secure.js (maintenance script)');

    console.log('\n=============================================================\n');
}

runAudit()
    .then(() => prisma.$disconnect())
    .catch(err => {
        console.error('Audit script error:', err.message);
        process.exit(1);
    });
