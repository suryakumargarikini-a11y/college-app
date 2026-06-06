require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const logger = require('../services/logger');

async function validateDatabaseConnection() {
    logger.info('[DB-Validation] Initializing validation on PostgreSQL database...');
    console.log('[DB-Validation] Initializing validation on PostgreSQL database...');
    
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
        
        logger.info('[DB-Validation] PostgreSQL Database connection successfully validated!');
        console.log('[DB-Validation] PostgreSQL Database connection successfully validated! 🚀');
        await prisma.$disconnect();
        process.exit(0);
    } catch (err) {
        logger.error(`[DB-Validation] Critical: PostgreSQL Database validation failed: ${err.message}`, { stack: err.stack });
        console.error(`[DB-Validation] Critical: PostgreSQL Database validation failed: ${err.message}`);
        await prisma.$disconnect();
        process.exit(1);
    }
}

validateDatabaseConnection();
