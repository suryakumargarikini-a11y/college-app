const prisma = require('../services/dbService');

async function run() {
    try {
        const triggers = await prisma.$queryRawUnsafe(`SELECT name, tbl_name, sql FROM sqlite_master WHERE type='trigger';`);
        console.log('Triggers in database:', triggers);
    } catch (err) {
        console.error('Error querying triggers:', err);
    } finally {
        await prisma.$disconnect();
    }
}

run();
