'use strict';
require('dotenv').config();
const prisma = require('./services/dbService');
const crypto = require('crypto');

const salt = process.env.ADMIN_PASSWORD_SALT;

function hashPassword(pwd) {
    return crypto.createHmac('sha256', salt).update(pwd).digest('hex');
}

async function main() {
    console.log('--- Checking Current DB Passwords & Hashes ---');
    console.log('Using ADMIN_PASSWORD_SALT:', salt);

    const admins = await prisma.admin.findMany({
        where: { email: { in: ['admin@sitamecap.co.in', 'guard@sitamecap.co.in'] } },
        select: { email: true, role: true, passwordHash: true }
    });

    for (const a of admins) {
        console.log(`\nEmail: ${a.email} (${a.role})`);
        console.log(`Stored Hash: ${a.passwordHash}`);

        const testPwds = [
            'Admin@SITAM2024',
            'Guard@SITAM2024',
            'Admin@1234',
            'Guard@1234',
            'Admin@123',
            'Password123!',
            'Demo@1234',
            'admin',
            'guard'
        ];

        for (const pwd of testPwds) {
            const h = hashPassword(pwd);
            if (h === a.passwordHash) {
                console.log(`  👉 MATCHES PASSWORD: "${pwd}" (Length: ${pwd.length})`);
            }
        }
    }
}

main().then(() => prisma.$disconnect()).catch(e => { console.error(e); process.exit(1); });
