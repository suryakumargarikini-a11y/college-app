const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
    try {
        const students = await prisma.student.findMany({
            take: 10,
            select: {
                id: true,
                userId: true,
                roll: true,
                name: true
            }
        });
        console.log('Sample students:');
        students.forEach(s => {
            console.log(`- ID: ${s.id}, userId: ${s.userId}, Roll: ${s.roll}, Name: ${s.name}`);
        });
    } catch (err) {
        console.error('Failed to query:', err.message || err);
    } finally {
        await prisma.$disconnect();
    }
}

main();
