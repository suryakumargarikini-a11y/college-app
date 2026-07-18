'use strict';
const path = require('path');
process.env.DATABASE_URL = 'file:' + path.resolve(__dirname, '..', 'prisma', 'dev.db').replace(/\\/g, '/');
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

async function main() {
    const students = await p.student.findMany({
        take: 10,
        select: { userId: true, name: true, lastSync: true, program: true, branch: true }
    });
    console.log(`Students in DB: ${students.length}`);
    for (const s of students) {
        console.log(`  ${s.userId} | ${s.name} | program=${s.program} | lastSync=${s.lastSync}`);
    }

    const syncHistoryCount = await p.syncHistory.count().catch(() => -1);
    console.log(`SyncHistory rows: ${syncHistoryCount}`);

    const recentSync = await p.syncHistory.findMany({
        take: 5,
        orderBy: { startedAt: 'desc' },
        select: { requestId: true, studentId: true, status: true, provider: true, startedAt: true, duration: true, error: true }
    }).catch(() => []);
    if (recentSync.length > 0) {
        console.log('\nRecent SyncHistory:');
        for (const s of recentSync) console.log(' ', JSON.stringify(s));
    }
}
main().catch(e => console.error('Error:', e.message)).finally(() => p.$disconnect());
