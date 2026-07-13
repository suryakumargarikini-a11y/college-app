const prisma = require('../services/dbService');

async function main() {
    const students = await prisma.student.findMany({
        take: 10,
        select: {
            userId: true,
            name: true,
            email: true,
            roll: true
        }
    });
    console.log("=== STUDENTS IN DB ===");
    console.log(JSON.stringify(students, null, 2));
    await prisma.$disconnect();
}

main().catch(console.error);
