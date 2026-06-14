const fs = require('fs');
const path = require('path');

const prismaDir = path.join(__dirname, '..', 'prisma');
const pgSchema = path.join(prismaDir, 'schema.postgresql.prisma');
const targetSchema = path.join(prismaDir, 'schema.prisma');

try {
    if (fs.existsSync(pgSchema)) {
        fs.copyFileSync(pgSchema, targetSchema);
        console.log('[Prisma-Config] Successfully switched Prisma schema provider to PostgreSQL.');
    } else {
        console.error('[Prisma-Config] Error: schema.postgresql.prisma not found.');
        process.exit(1);
    }
} catch (err) {
    console.error(`[Prisma-Config] Failed to switch schema provider: ${err.message}`);
    process.exit(1);
}
