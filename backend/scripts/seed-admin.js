'use strict';
require('dotenv').config();
const crypto = require('crypto');

const SALT = process.env.ADMIN_PASSWORD_SALT || 'sitam-admin-salt';

function hashPassword(password) {
    return crypto.createHmac('sha256', SALT).update(password).digest('hex');
}

async function main() {
    const { PrismaClient } = require('@prisma/client');
    const prisma = new PrismaClient();

    try {
        // 1. Seed System Settings
        console.log('[Seed] Setting up default system settings...');
        const setting = await prisma.systemSetting.upsert({
            where: { id: 'system' },
            update: {},
            create: {
                id: 'system',
                maintenanceMode: false,
                maintenanceMessage: 'SITAM Smart ERP is currently undergoing scheduled maintenance. Please try again later.'
            }
        });
        console.log(`[Seed] SystemSetting verified: Maintenance Mode is ${setting.maintenanceMode ? 'ON' : 'OFF'}`);

        // 2. Define standard admins to seed
        const admins = [
            {
                email: 'admin@sitamecap.co.in',
                password: 'Admin@SITAM2024',
                name: 'SITAM Administrator',
                role: 'SUPER_ADMIN'
            },
            {
                email: 'guard@sitamecap.co.in',
                password: 'Guard@SITAM2024',
                name: 'Gate Security Guard',
                role: 'SECURITY_GUARD'
            },
            {
                email: 'accounts@sitamecap.co.in',
                password: 'Accounts@SITAM2024',
                name: 'SITAM Accounts Admin',
                role: 'ACCOUNTS_ADMIN'
            },
            {
                email: 'placement@sitamecap.co.in',
                password: 'Placement@SITAM2024',
                name: 'SITAM Placement Admin',
                role: 'PLACEMENT_ADMIN'
            }
        ];

        console.log('[Seed] Seeding administrators...');
        for (const adminData of admins) {
            const existing = await prisma.admin.findUnique({ where: { email: adminData.email } });
            if (existing) {
                // Ensure correct role and status
                await prisma.admin.update({
                    where: { email: adminData.email },
                    data: { role: adminData.role, name: adminData.name }
                });
                console.log(`[Seed] Admin updated/verified: ${adminData.email} (${adminData.role})`);
            } else {
                const admin = await prisma.admin.create({
                    data: {
                        email: adminData.email,
                        passwordHash: hashPassword(adminData.password),
                        name: adminData.name,
                        role: adminData.role,
                        isActive: true
                    }
                });
                console.log(`[Seed] Created admin: ${admin.email} | Role: ${admin.role} | Pwd: ${adminData.password}`);
            }
        }
        console.log('✅ Seeding complete!');
    } finally {
        await prisma.$disconnect();
    }
}

main().catch(err => {
    console.error('[Seed] Fatal error:', err.message);
    process.exit(1);
});
