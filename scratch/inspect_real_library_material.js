'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '../backend/.env') });
const prisma = require('../backend/services/dbService');
const fs = require('fs');
const path = require('path');

async function inspect() {
    try {
        const material = await prisma.libraryMaterial.findFirst();
        console.log('REAL LIBRARY MATERIAL RECORD:');
        console.log(JSON.stringify(material, null, 2));

        if (material) {
            const diskPath = path.join(__dirname, '../backend/uploads/library', material.fileName);
            console.log(`Checking local file on disk: ${diskPath}`);
            console.log(`Exists: ${fs.existsSync(diskPath)}`);
        }
    } catch (e) {
        console.error('Error:', e.message);
    }
    process.exit(0);
}
inspect();
