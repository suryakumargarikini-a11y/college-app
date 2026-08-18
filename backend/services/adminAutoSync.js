'use strict';

const crypto = require('crypto');
const prisma = require('./dbService');
const logger = require('./logger');

async function autoSyncAdminCredentials() {
    try {
        const salt = process.env.ADMIN_PASSWORD_SALT;
        if (!salt || salt.trim() === '') return;

        const hashPassword = (pwd) => crypto.createHmac('sha256', salt).update(pwd).digest('hex');

        const adminHash = hashPassword('Admin@SITAM2024');
        const guardHash = hashPassword('Guard@SITAM2024');
        const hodHash   = hashPassword('Admin@SITAM2024');

        await prisma.admin.updateMany({
            where: { email: 'admin@sitamecap.co.in' },
            data: { passwordHash: adminHash }
        });

        await prisma.admin.updateMany({
            where: { email: 'guard@sitamecap.co.in' },
            data: { passwordHash: guardHash }
        });

        await prisma.admin.updateMany({
            where: { role: 'HOD' },
            data: { passwordHash: hodHash }
        });

        logger.info('[AdminAuth] Admin, Guard & HOD password hashes synchronized with active runtime salt.');

    } catch (err) {
        logger.error(`[AdminAuth] Password sync error: ${err.message}`);
    }
}

module.exports = { autoSyncAdminCredentials };
