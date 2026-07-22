const prisma = require('../services/dbService');

async function test() {
    try {
        console.log('Testing prisma.$transaction with Serializable isolation level...');
        const student = await prisma.student.findFirst();
        if (!student) {
            console.log('No student found in DB.');
            return;
        }
        console.log('Found student:', student.id, student.name);

        const res = await prisma.$transaction(async (tx) => {
            const existing = await tx.exitPass.findFirst({
                where: { studentId: student.id, status: { in: ['PENDING', 'APPROVED'] } }
            });
            console.log('Existing pass:', existing ? existing.id : 'None');

            return tx.exitPass.create({
                data: {
                    studentId: student.id,
                    reason: 'Medical Test',
                    destination: 'Visakhapatnam',
                    exitTime: new Date(Date.now() + 86400000),
                    returnTime: null,
                    emergencyContact: '9876543210',
                    remarks: null,
                    requestedDate: 'Jul 23, 2026',
                    status: 'PENDING'
                }
            });
        }, {
            isolationLevel: 'Serializable',
            maxWait: 10000,
            timeout: 15000
        });

        console.log('Transaction succeeded! Created pass:', res.id);

        // Clean up test pass
        await prisma.exitPass.delete({ where: { id: res.id } });
        console.log('Cleaned up test pass.');
    } catch (err) {
        console.error('Test FAILED with error:');
        console.error(err);
    } finally {
        await prisma.$disconnect();
    }
}

test();
