const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

async function main() {
    const slots = await p.timetableSlot.findMany({
        where: { student: { userId: '25B61A0596' } },
        include: { subject: true },
        orderBy: [{ day: 'asc' }, { period: 'asc' }]
    });

    console.log('Total slots:', slots.length);

    const dayOrder = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    const byDay = {};
    slots.forEach(s => {
        if (!byDay[s.day]) byDay[s.day] = [];
        byDay[s.day].push(s);
    });

    dayOrder.forEach(day => {
        if (!byDay[day]) return;
        console.log('\n' + day + ' (' + byDay[day].length + ' slots):');
        byDay[day].forEach(s => {
            console.log(`  Period ${s.period} | ${s.time || 'NO TIME'} | ${s.subject.code} | ${s.subject.name} | Room: ${s.room}`);
        });
    });

    // Check what unique days exist
    console.log('\nUnique days in DB:', [...new Set(slots.map(s => s.day))]);
    // Check time field
    console.log('Sample time values:', slots.slice(0,3).map(s => JSON.stringify(s.time)));
    // Check period field
    console.log('Sample period values:', slots.slice(0,3).map(s => JSON.stringify(s.period)));
}

main().catch(console.error).finally(() => p.$disconnect());
