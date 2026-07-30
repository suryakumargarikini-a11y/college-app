'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '../backend/.env') });
const prisma = require('../backend/services/dbService');

async function check() {
    try {
        const records = await prisma.libraryMaterial.findMany();
        process.stdout.write(`LibraryMaterial Count: ${records.length}\n`);
        process.stdout.write(JSON.stringify(records, null, 2) + '\n');
    } catch (e) {
        process.stdout.write(`Error: ${e.message}\n`);
    }
    process.exit(0);
}
check();
