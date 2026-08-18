'use strict';
/**
 * PRE-CHANGE AUDIT SCRIPT — admin@sitamecap.co.in
 * 
 * READS ONLY. Does NOT modify any data.
 * Verifies existence, role, isActive, and confirms the account is safe to update.
 * 
 * SECURITY: Never prints passwordHash, DATABASE_URL, ADMIN_PASSWORD_SALT, or any JWTs.
 */
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const TARGET_EMAIL = 'admin@sitamecap.co.in';

async function preAudit() {
    console.log('=============================================================');
    console.log('  PRE-CHANGE AUDIT — admin@sitamecap.co.in');
    console.log('  READ-ONLY. No data will be modified.');
    console.log('=============================================================\n');

    const dbUrl = process.env.DATABASE_URL;
    const saltPresent = !!(process.env.ADMIN_PASSWORD_SALT && process.env.ADMIN_PASSWORD_SALT.trim());

    const u = new URL(dbUrl);
    console.log('Database host  :', u.hostname);
    console.log('Database name  :', u.pathname.replace('/', ''));
    console.log('NODE_ENV       :', process.env.NODE_ENV || '(not set)');
    console.log('SALT present   :', saltPresent ? 'YES' : 'NO');
    console.log();

    const record = await prisma.admin.findUnique({
        where: { email: TARGET_EMAIL },
        select: {
            id: true,
            email: true,
            name: true,
            role: true,
            isActive: true,
            createdAt: true,
            updatedAt: true
            // passwordHash intentionally EXCLUDED
        }
    });

    if (!record) {
        console.error('RESULT: ACCOUNT NOT FOUND — no changes should be made.');
        process.exit(1);
    }

    console.log('Account found  :', record.email);
    console.log('Name           :', record.name);
    console.log('Role           :', record.role);
    console.log('isActive       :', record.isActive);
    console.log('Created        :', record.createdAt);
    console.log('Last updated   :', record.updatedAt);
    console.log();

    if (!record.isActive) {
        console.warn('WARNING: Account is INACTIVE. Proceeding with reset is safe but account may still be blocked.');
    } else {
        console.log('STATUS: Account is ACTIVE ✓');
    }

    if (record.role === 'SUPER_ADMIN') {
        console.log('ROLE CHECK: SUPER_ADMIN ✓');
    } else {
        console.warn('ROLE CHECK: Role is "' + record.role + '" — not SUPER_ADMIN. Confirm this is the correct account.');
    }

    console.log('\nPRE-AUDIT COMPLETE — Safe to proceed with password reset.\n');
}

preAudit()
    .then(() => prisma.$disconnect())
    .catch(e => { console.error('Audit error:', e.message); process.exit(1); });
