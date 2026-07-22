const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

console.log("Prisma client properties:");
const props = Object.keys(prisma);
console.log(props.filter(p => !p.startsWith('_')));

prisma.$disconnect();
