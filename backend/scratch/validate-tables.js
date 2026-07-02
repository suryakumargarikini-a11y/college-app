const { PrismaClient } = require('@prisma/client');
require('dotenv').config();

async function checkModels() {
    const prisma = new PrismaClient();
    console.log('--- Database Verification Script ---');
    try {
        // 1. Check Survey
        const surveysCount = await prisma.survey.count().catch(err => {
            console.error('❌ Survey table does not exist or failed:', err.message);
            return null;
        });
        if (surveysCount !== null) {
            console.log(`✅ Survey model exists. Count: ${surveysCount}`);
        }

        // 2. Check HelpTicket
        const ticketsCount = await prisma.helpTicket.count().catch(err => {
            console.error('❌ HelpTicket table does not exist or failed:', err.message);
            return null;
        });
        if (ticketsCount !== null) {
            console.log(`✅ HelpTicket model exists. Count: ${ticketsCount}`);
        }

        // 3. Check LostFoundItem
        const lfCount = await prisma.lostFoundItem.count().catch(err => {
            console.error('❌ LostFoundItem table does not exist or failed:', err.message);
            return null;
        });
        if (lfCount !== null) {
            console.log(`✅ LostFoundItem model exists. Count: ${lfCount}`);
        }

        // 4. Check SavedPlacement
        const savedCount = await prisma.savedPlacement.count().catch(err => {
            console.error('❌ SavedPlacement table does not exist or failed:', err.message);
            return null;
        });
        if (savedCount !== null) {
            console.log(`✅ SavedPlacement model exists. Count: ${savedCount}`);
        }
    } catch (err) {
        console.error('Database connection failed entirely:', err.message);
    } finally {
        await prisma.$disconnect();
    }
}

checkModels();
