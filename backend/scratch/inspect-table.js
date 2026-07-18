const prisma = require('../services/dbService');

async function run() {
    try {
        const info = await prisma.$queryRawUnsafe(`PRAGMA table_info("AuditLog");`);
        console.log('AuditLog Table Columns:', info);
    } catch (err) {
        console.error('Error querying table info:', err);
    } finally {
        await prisma.$disconnect();
    }
}

run();
