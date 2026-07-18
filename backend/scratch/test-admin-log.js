const prisma = require('../services/dbService');
const { auditLogRepository } = require('../repositories/index');

async function run() {
    try {
        const admin = await prisma.admin.findFirst();
        if (!admin) {
            console.log('No admin found in database!');
            return;
        }
        console.log('Found admin:', admin.email, 'ID:', admin.id);
        
        console.log('Attempting write to AuditLog table with admin connection...');
        const res = await auditLogRepository.log(null, 'ADMIN_LOGIN', `Admin ${admin.email} signed in successfully`, admin.id, 'SECURITY');
        console.log('Write success! Inserted:', res);
    } catch (err) {
        console.error('Write failed:', err);
    } finally {
        await prisma.$disconnect();
    }
}

run();
