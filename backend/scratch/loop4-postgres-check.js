'use strict';
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

async function main() {
    console.log('Connecting to PostgreSQL database...');
    const studentCount = await p.student.count();
    console.log(`Connected successfully! Student count: ${studentCount}`);
}
main().catch(e => console.error('DB Error:', e.message)).finally(() => p.$disconnect());
