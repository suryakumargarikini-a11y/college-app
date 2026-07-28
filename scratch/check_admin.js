// Safe diagnostic script for Admin Portal login investigation
process.env.NODE_PATH = 'd:/111/backend/node_modules';
require('module').Module._initPaths();

const prisma = require('../backend/services/dbService');

async function run() {
    console.log('=== ADMIN LOGIN DIAGNOSTIC ===');
    try {
        const email = 'accounts@sitamecap.co.in';
        const admin = await prisma.admin.findUnique({ where: { email } });

        console.log('ADMIN_FOUND:', !!admin);
        if (admin) {
            console.log('ADMIN_ACTIVE:', admin.isActive);
            console.log('ADMIN_ROLE:', admin.role);
            console.log('PASSWORD_HASH_PRESENT:', !!admin.passwordHash);
            console.log('PASSWORD_HASH_LENGTH:', admin.passwordHash ? admin.passwordHash.length : 0);
            console.log('HASH_TYPE:', admin.passwordHash ? (admin.passwordHash.length === 64 ? 'SHA256_HMAC' : admin.passwordHash.startsWith('$2') ? 'BCRYPT' : 'OTHER') : 'NONE');
        } else {
            console.log('All admins in DB:');
            const allAdmins = await prisma.admin.findMany({ select: { id: true, email: true, role: true, isActive: true } });
            console.log(allAdmins);
        }

        // Check environment variables setup
        const rawJwtSecret = process.env.ADMIN_JWT_SECRET;
        const rawSalt = process.env.ADMIN_PASSWORD_SALT;

        console.log('ADMIN_JWT_SECRET_PRESENT:', !!rawJwtSecret);
        console.log('ADMIN_JWT_SECRET_LENGTH:', rawJwtSecret ? rawJwtSecret.length : 0);
        console.log('ADMIN_PASSWORD_SALT_PRESENT:', !!rawSalt);

    } catch (err) {
        console.error('Diagnostic error:', err.message, err.stack);
    } finally {
        await prisma.$disconnect();
    }
}

run();
