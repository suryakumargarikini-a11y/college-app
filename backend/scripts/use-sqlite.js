const fs = require('fs');
const path = require('path');

const prismaDir = path.join(__dirname, '..', 'prisma');
const sqliteSchema = path.join(prismaDir, 'schema.sqlite.prisma');
const targetSchema = path.join(prismaDir, 'schema.prisma');

try {
    if (fs.existsSync(sqliteSchema)) {
        fs.copyFileSync(sqliteSchema, targetSchema);
        console.log('[Prisma-Config] Successfully switched Prisma schema provider to SQLite.');
    } else {
        console.error('[Prisma-Config] Error: schema.sqlite.prisma not found.');
        process.exit(1);
    }
} catch (err) {
    console.error(`[Prisma-Config] Failed to switch schema provider: ${err.message}`);
    process.exit(1);
}
