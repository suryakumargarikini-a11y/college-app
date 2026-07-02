'use strict';
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// Load backend .env explicitly
const backendEnv = require('dotenv').parse(fs.readFileSync(path.join(__dirname, '../.env')));
console.log('Backend Env DATABASE_URL:', backendEnv.DATABASE_URL);
console.log('Backend Env ADMIN_PASSWORD_SALT:', backendEnv.ADMIN_PASSWORD_SALT);

// Load root .env explicitly
let rootEnv = {};
if (fs.existsSync(path.join(__dirname, '../../.env'))) {
    rootEnv = require('dotenv').parse(fs.readFileSync(path.join(__dirname, '../../.env')));
    console.log('Root Env DATABASE_URL:', rootEnv.DATABASE_URL);
}

const { PrismaClient } = require('@prisma/client');

async function testConnection(dbUrl, provider, label) {
    console.log(`\nTesting connection for: ${label} (${provider})`);
    console.log(`URL: ${dbUrl}`);
    
    // We can temporarily set the env variable for Prisma
    process.env.DATABASE_URL = dbUrl;
    
    // If provider is sqlite but the schema.prisma has sqlite, or postgresql and schema has postgresql
    // Wait, the client is generated with the active schema.prisma provider
    const prisma = new PrismaClient({
        datasources: {
            db: { url: dbUrl }
        }
    });

    try {
        await prisma.$connect();
        console.log(`[${label}] Connection successful!`);
        
        // Count or query admins
        const adminCount = await prisma.admin.count();
        console.log(`[${label}] Admin count:`, adminCount);
        
        const admins = await prisma.admin.findMany();
        console.log(`[${label}] Admin accounts:`);
        admins.forEach(a => {
            console.log(`  - ID: ${a.id} | Email: ${a.email} | Name: ${a.name} | Role: ${a.role} | IsActive: ${a.isActive} | Hash: ${a.passwordHash}`);
        });
        
        await prisma.$disconnect();
        return { success: true, admins };
    } catch (err) {
        console.error(`[${label}] Error:`, err.message);
        return { success: false, error: err.message };
    }
}

async function main() {
    // 1. Let's look at the generated Prisma Client provider first by inspecting node_modules/@prisma/client/package.json or similar, or just running queries
    // Actually, we can test whichever database works.
    
    // Try local sqlite
    const sqliteUrl = backendEnv.DATABASE_URL || 'file:./dev.db';
    const sqliteResult = await testConnection(sqliteUrl, 'sqlite', 'Backend SQLite DB');
    
    // Try root env pg
    if (rootEnv.DATABASE_URL) {
        const pgResult = await testConnection(rootEnv.DATABASE_URL, 'postgresql', 'Root PG DB');
    }
}

main().catch(console.error);
