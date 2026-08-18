'use strict';
/**
 * DIAGNOSTIC ONLY — READ-ONLY SALT COMPARISON
 * 
 * Queries current DB passwordHash for admin@sitamecap.co.in
 * and fingerprints it safely (first 8 + last 8 chars only).
 * 
 * Then computes what LOCAL salt + known passwords would produce
 * to identify whether the DB hash was written by LOCAL salt or RAILWAY salt.
 * 
 * NEVER prints: the full hash, DATABASE_URL, ADMIN_PASSWORD_SALT, passwords, JWTs.
 */
require('dotenv').config();
const crypto = require('crypto');
const { PrismaClient } = require('@prisma/client');

const TARGET_EMAIL = 'admin@sitamecap.co.in';

async function diagnose() {
    const prisma = new PrismaClient();
    const localSalt = process.env.ADMIN_PASSWORD_SALT;

    // Read the CURRENT hash from DB (not from our earlier notes — may have changed)
    const record = await prisma.admin.findUnique({
        where: { email: TARGET_EMAIL },
        select: { passwordHash: true, email: true, role: true, isActive: true }
    });
    await prisma.$disconnect();

    if (!record) { console.error('Account not found'); process.exit(1); }

    const storedHash = record.passwordHash;
    // Safe fingerprint only
    const storedFp = storedHash.slice(0, 8) + '...' + storedHash.slice(-8);

    console.log('\n=== DIAGNOSTIC: DB HASH vs LOCAL SALT ===\n');
    console.log('Account      :', record.email, '| role:', record.role, '| isActive:', record.isActive);
    console.log('Stored hash  :', storedFp, '(first 8 + last 8 chars — safe fingerprint only)');

    // Generate what local salt would produce for candidate passwords
    const candidates = [
        'Admin@SITAM2024',
        'Admin@1234',
        'Admin@123',
        'sitam@admin',
        'SITAM@2024',
        'admin@sitam',
    ];

    console.log('\n--- Checking if stored hash matches LOCAL salt + candidate passwords ---');
    let matched = false;
    for (const pwd of candidates) {
        const localHash = crypto.createHmac('sha256', localSalt).update(pwd).digest('hex');
        const localFp   = localHash.slice(0, 8) + '...' + localHash.slice(-8);
        const match     = localHash === storedHash;
        if (match) {
            console.log('  MATCH FOUND with LOCAL salt: password = [REDACTED — matched candidate index ' + candidates.indexOf(pwd) + ']');
            matched = true;
        } else {
            console.log('  no match: candidate', candidates.indexOf(pwd), '-> local hash', localFp);
        }
    }

    if (!matched) {
        console.log('\n  No local-salt candidate matched the stored hash.');
        console.log('  CONCLUSION: DB hash was written using a DIFFERENT salt (likely Railway production salt).');
        console.log('  The production authController.js (using Railway salt) should be able to verify it');
        console.log('  IF the password entered matches what adminAutoSync.js wrote.');
    }

    // Also check if LOCAL fingerprint changed since 16:06 UTC reference
    const knownLocalHash = 'c1782ff36573fc2eea541c0b59228d44c284d13a8b28aa9e9de03efa88250304';
    const dbMatchesEarlierLocalReset = storedHash === knownLocalHash;
    console.log('\n--- Cross-check with reset at 16:06 UTC ---');
    console.log('DB hash matches 16:06 LOCAL reset hash:', dbMatchesEarlierLocalReset
        ? 'YES — adminAutoSync did NOT overwrite it (Railway salt == local salt OR autoSync skipped)'
        : 'NO  — DB hash changed after 16:06, likely overwritten by adminAutoSync at startup (16:21 UTC)');
}

diagnose().catch(e => { console.error('[FATAL]', e.message); process.exit(1); });
