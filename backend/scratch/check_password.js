const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
async function main() {
    const s = await p.student.findUnique({ where: { userId: '25B61A0596' } });
    if (!s) { console.log('Student not found'); return; }
    console.log('Stored password:', JSON.stringify(s.password));
    console.log('Test password "harika@123" matches:', s.password === 'harika@123');
}
main().catch(console.error).finally(() => p.$disconnect());
