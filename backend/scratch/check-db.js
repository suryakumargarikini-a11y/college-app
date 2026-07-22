'use strict';
const prisma = require('../services/dbService');

async function check() {
    const counts = await prisma.exitPass.groupBy({
        by: ['status'],
        _count: { status: true }
    });
    console.log('Pass status summary in DB:', counts);

    const approvedPasses = await prisma.exitPass.findMany({
        where: { status: 'APPROVED' },
        take: 5,
        include: { student: true }
    });
    console.log('Approved passes count:', approvedPasses.length);
    approvedPasses.forEach(p => {
        console.log({
            id: p.id,
            status: p.status,
            studentRoll: p.student?.roll,
            studentName: p.student?.name,
            destination: p.destination,
            hasQrCode: !!p.qrCode,
            hasHash: !!p.qrTokenHash,
            verifiedAt: p.verifiedAt,
            verifiedBy: p.verifiedBy,
            createdAt: p.createdAt,
            approvedAt: p.approvedAt
        });
    });

    const pendingPasses = await prisma.exitPass.findMany({
        where: { status: 'PENDING' },
        take: 5,
        include: { student: true }
    });
    console.log('Pending passes count:', pendingPasses.length);
    pendingPasses.forEach(p => {
        console.log({
            id: p.id,
            status: p.status,
            studentRoll: p.student?.roll,
            studentName: p.student?.name,
            destination: p.destination,
            createdAt: p.createdAt
        });
    });

    await prisma.$disconnect();
}

check();
