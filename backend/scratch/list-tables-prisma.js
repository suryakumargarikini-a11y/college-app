const prisma = require('../services/dbService');

async function run() {
    try {
        const tables = await prisma.$queryRawUnsafe(`SELECT name FROM sqlite_master WHERE type='table';`);
        console.log('Tables in database (via Prisma):', tables.map(t => t.name));
    } catch (err) {
        console.error('Error querying via Prisma:', err);
    } finally {
        await prisma.$disconnect();
    }
}

run();
