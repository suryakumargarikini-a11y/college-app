'use strict';
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
(async () => {
  const result = await prisma.$queryRawUnsafe(`
    SELECT table_name, column_name, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name IN ('LibraryMaterial','LibraryView','LibraryDownload','AdminNotification')
    ORDER BY table_name, ordinal_position
  `);
  const counts = await prisma.$queryRawUnsafe('SELECT count(*)::integer AS notifications FROM "AdminNotification"');
  console.log(JSON.stringify({ columns: result, counts }, null, 2));
})().catch(e => { console.error(e.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
