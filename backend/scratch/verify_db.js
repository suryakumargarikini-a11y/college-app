const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
async function main() {
    const s = await p.student.findFirst();
    if (!s) { console.log('NO STUDENTS IN DB'); return; }
    console.log('Student:', s.name, '| userId:', s.userId, '| password:', s.password ? 'SET' : 'MISSING');
    console.log('CGPA:', s.cgpa, '| semester:', s.semester);
    const att = await p.attendanceRecord.count({ where: { studentId: s.id } });
    const fees = await p.fee.count({ where: { studentId: s.id } });
    const marks = await p.markRecord.count({ where: { studentId: s.id } });
    const tt = await p.timetableSlot.count({ where: { studentId: s.id } });
    console.log('Attendance records:', att, '| Fees:', fees, '| Marks:', marks, '| Timetable:', tt);
}
main().catch(console.error).finally(() => p.$disconnect());
