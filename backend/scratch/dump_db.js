const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const student = await prisma.student.findUnique({
    where: { userId: '25B61A0596' },
    include: {
      attendance: true,
      fees: true,
      marks: true,
    }
  });

  if (!student) {
    console.log('Student 25B61A0596 not found in DB!');
    return;
  }

  console.log('=== Student Info ===');
  console.log(`Name: ${student.name}`);
  console.log(`Roll: ${student.roll}`);
  console.log(`Semester: ${student.semester}`);
  console.log(`Branch: ${student.branch}`);
  console.log(`Attendance Records Count: ${student.attendance.length}`);
  console.log(`Fees Count: ${student.fees.length}`);
  console.log(`Marks Count: ${student.marks.length}`);

  if (student.attendance.length > 0) {
    console.log('\n=== Sample Attendance ===');
    console.log(student.attendance.slice(0, 3));
  }

  if (student.fees.length > 0) {
    console.log('\n=== Sample Fees ===');
    console.log(student.fees.slice(0, 3));
  }
}

main()
  .catch(e => console.error(e))
  .finally(async () => {
    await prisma.$disconnect();
  });
