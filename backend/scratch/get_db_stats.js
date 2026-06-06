const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

async function main() {
    const students = await p.student.findMany({
        include: {
            _count: {
                select: {
                    marks: true,
                    timetable: true,
                    attendance: true,
                    assignments: true,
                    notifications: true,
                    fees: true
                }
            }
        }
    });
    console.log(JSON.stringify(students, null, 2));
}

main().catch(console.error).finally(() => p.$disconnect());
