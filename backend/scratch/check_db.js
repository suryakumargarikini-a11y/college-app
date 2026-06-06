const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const student = await prisma.student.findFirst({
        include: {
            attendance: {
                include: { subject: true }
            },
            fees: true
        }
    });

    if (!student) {
        console.log('No student found in the database.');
        return;
    }

    console.log('--- STUDENT ---');
    console.log('ID:', student.id);
    console.log('Name:', student.name);
    console.log('UserId:', student.userId);
    console.log('Roll Number:', student.roll_number);
    console.log('Semester:', student.semester);
    console.log('Branch:', student.branch);

    console.log('--- ATTENDANCE ---');
    console.log('Records count:', student.attendance.length);
    student.attendance.forEach(a => {
        console.log(`- ${a.subject.code}: Held=${a.held}, Attended=${a.attended}, Pct=${a.percentage}%`);
    });

    console.log('--- FEES ---');
    console.log('Fees count:', student.fees.length);
    student.fees.forEach(f => {
        console.log(`- ${f.feeType}: Amount=${f.amount}, Paid=${f.paidAmount}, Due=${f.dueAmount}, Status=${f.paymentStatus}`);
    });
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
