'use strict';
// seed-department-aliases.js
// Idempotent seed for DepartmentAlias table.
// Confirmed aliases only - no invented values.
// Safe to run multiple times: upsert on rawValue.

try { require('dotenv').config(); } catch (_) {}
if (process.env.NODE_ENV === 'production' || process.env.RENDER) {
  try { require('./use-pg'); } catch (e) { console.error('[Alias] Failed to switch to PG:', e.message); }
}

const ALIASES = [
  { rawValue: 'AIML',                                    canonical: 'AIML' },
  { rawValue: 'CSE',                                     canonical: 'AIML' },
  { rawValue: 'COMPUTER SCIENCE ENGINEERING',            canonical: 'AIML' },
  { rawValue: 'AIDS',                                    canonical: 'AIDS' },
  { rawValue: 'ARTIFICIAL INTELLIGENCE AND DATA SCIENCE',canonical: 'AIDS' },
  { rawValue: 'ECE',                                     canonical: 'ECE'  },
  { rawValue: 'ELECTRONICS & COMMUNICATION ENGINEERING', canonical: 'ECE'  },
  { rawValue: 'IT',                                      canonical: 'IT'   },
  { rawValue: 'MECH',                                    canonical: 'MECH' },
  { rawValue: 'CIVIL',                                   canonical: 'CIVIL'},
  { rawValue: 'EEE',                                     canonical: 'EEE'  },
  { rawValue: 'MBA',                                     canonical: 'MBA'  },
  { rawValue: 'POLYTECHNIC',                             canonical: 'POLYTECHNIC' },
];

async function main() {
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  try {
    let created = 0, skipped = 0;
    for (const alias of ALIASES) {
      const result = await prisma.departmentAlias.upsert({
        where:  { rawValue: alias.rawValue },
        update: { canonical: alias.canonical },
        create: alias,
      });
      if (result) created++;
    }
    const total = await prisma.departmentAlias.count();
    console.log('[Alias] DepartmentAlias rows total:', total, '(expected 13)');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(e => { console.error('[Alias] Seed failed:', e.message); process.exit(1); });