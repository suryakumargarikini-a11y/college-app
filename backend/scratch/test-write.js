const prisma = require('../services/dbService');

async function run() {
    try {
        console.log('Attempting write to AuditLog table...');
        const res = await prisma.auditLog.create({
            data: {
                action: 'TEST',
                details: 'This is a test write',
                severity: 'INFO'
            }
        });
        console.log('Write success! Inserted:', res);
    } catch (err) {
        console.error('Write failed:', err);
    } finally {
        await prisma.$disconnect();
    }
}

run();
