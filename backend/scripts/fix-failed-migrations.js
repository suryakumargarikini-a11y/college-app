'use strict';
// fix-failed-migrations.js - Delete failed Phase 2A migration rows from _prisma_migrations
// This unblocks prisma migrate deploy after BOM-caused failure on first attempt.
try { require('dotenv').config(); } catch (_) {}
if (process.env.NODE_ENV === 'production' || process.env.RENDER) {
  try { require('./use-pg'); } catch (e) {}
}
const { PrismaClient } = require('@prisma/client');
async function main() {
  const prisma = new PrismaClient();
  try {
    const n = await prisma[String.fromCharCode(36) + 'executeRawUnsafe'](
      [
        'DELETE FROM',
        '"_prisma_migrations"',
        'WHERE migration_name LIKE',
        "'20260729%'",
        'AND finished_at IS NULL AND rolled_back_at IS NULL'
      ].join(' ')
    );
    console.log('[fix-migrations] Deleted ' + n + ' failed record(s) from _prisma_migrations');
  } catch (e) {
    console.error('[fix-migrations] Non-fatal error:', e.message);
  } finally {
    try { await prisma[String.fromCharCode(36) + 'disconnect'](); } catch (_) {}
  }
}
main();