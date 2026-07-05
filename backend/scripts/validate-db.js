try {
    require('dotenv').config();
} catch (err) {
    console.warn('[DB-Validation] Note: dotenv module not found. Relying on system environment variables.');
}

if (process.env.NODE_ENV === 'production' || process.env.RENDER) {
    try {
        require('./use-pg');
    } catch (err) {
        console.error('[Startup] Failed to switch database provider to PostgreSQL in validation:', err.message);
    }
}

const { PrismaClient } = require('@prisma/client');
const logger = require('../services/logger');

async function validateDatabaseConnection() {
    logger.info('[DB-Validation] Initializing validation on database...');
    console.log('[DB-Validation] Initializing validation on database...');
    
    const prisma = new PrismaClient({
        datasources: {
            db: {
                url: process.env.DATABASE_URL
            }
        }
    });

    try {
        // Attempt a basic low-overhead raw query
        logger.info('[DB-Validation] Sending ping raw query...');
        await prisma.$queryRaw`SELECT 1`;
        
        logger.info('[DB-Validation] Database connection successfully validated!');
        console.log('[DB-Validation] Database connection successfully validated! 🚀');
        await prisma.$disconnect();
        process.exit(0);
    } catch (err) {
        logger.error(`[DB-Validation] Critical: Database validation failed: ${err.message}`, { stack: err.stack });
        console.error(`[DB-Validation] Critical: Database validation failed: ${err.message}`);
        await prisma.$disconnect();
        process.exit(1);
    }
}

validateDatabaseConnection();
