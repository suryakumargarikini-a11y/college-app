/**
 * Check Render DB admin password hashes and reset if salt mismatch
 */
'use strict';
require('dotenv').config();

const crypto = require('crypto');
const { PrismaClient } = require('@prisma/client');

const SALT = process.env.ADMIN_PASSWORD_SALT || 'sitam-admin-salt';

console.log('[DEBUG] Using ADMIN_PASSWORD_SALT:', SALT);

function hashPassword(password) {
    return crypto.createHmac('sha256', SALT).update(password).digest('hex');
}

const admins = [
    { email: 'admin@sitamecap.co.in',    password: 'Admin@SITAM2024',     role: 'SUPER_ADMIN' },
    { email: 'guard@sitamecap.co.in',    password: 'Guard@SITAM2024',     role: 'SECURITY_GUARD' },
    { email: 'accounts@sitamecap.co.in', password: 'Accounts@SITAM2024',  role: 'ACCOUNTS_ADMIN' },
    { email: 'placement@sitamecap.co.in',password: 'Placement@SITAM2024', role: 'PLACEMENT_ADMIN' }
];

async function main() {
    const prisma = new PrismaClient();
    try {
        // First: check what's in the DB
        console.log('\n[CHECK] Current admin hashes in DB:');
        for (const a of admins) {
            const row = await prisma.admin.findUnique({ where: { email: a.email }, select: { email: true, passwordHash: true, isActive: true } });
            if (!row) { console.log(`  ${a.email}: NOT FOUND`); continue; }
            const expectedHash = hashPassword(a.password);
            const matches = row.passwordHash === expectedHash;
            console.log(`  ${a.email}: hash_prefix=${row.passwordHash.slice(0,16)}... expected_prefix=${expectedHash.slice(0,16)}... MATCH=${matches}`);
        }

        console.log('\n[RESET] Re-seeding admin passwords with current salt...');
        for (const a of admins) {
            const hash = hashPassword(a.password);
            await prisma.admin.upsert({
                where: { email: a.email },
                update: { passwordHash: hash, isActive: true, role: a.role },
                create: { email: a.email, passwordHash: hash, name: a.email.split('@')[0], role: a.role, isActive: true }
            });
            console.log(`  [OK] ${a.email} — hash reset with current salt`);
        }
        console.log('\n[DONE] Seed complete. Try logging in again.');
    } catch (e) {
        console.error('[ERROR]', e.message);
    } finally {
        await prisma.$disconnect();
    }
}

main();
