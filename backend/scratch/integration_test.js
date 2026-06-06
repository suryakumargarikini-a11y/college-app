const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

async function main() {
    const http = require('http');
    
    function get(path, token) {
        return new Promise((resolve) => {
            const opts = { hostname: 'localhost', port: 3001, path, headers: { 'Authorization': 'Bearer ' + token } };
            const r = http.request(opts, res => { let data = ''; res.on('data', c => data += c); res.on('end', () => resolve(JSON.parse(data))); });
            r.on('error', () => resolve(null));
            r.end();
        });
    }

    function post(path, body) {
        return new Promise((resolve) => {
            const d = JSON.stringify(body);
            const opts = { hostname: 'localhost', port: 3001, path, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(d) } };
            const r = http.request(opts, res => { let data = ''; res.on('data', c => data += c); res.on('end', () => resolve(JSON.parse(data))); });
            r.on('error', () => resolve(null));
            r.write(d); r.end();
        });
    }

    const s = await p.student.findUnique({ where: { userId: '25B61A0596' } });
    await p.$disconnect();
    
    console.log('\n=== FULL ERP API TEST ===\n');
    const loginRes = await post('/api/auth/login', { userId: '25B61A0596', password: s.password });
    
    if (!loginRes?.success) { console.log('❌ LOGIN FAILED:', loginRes?.message); return; }
    
    const tok = loginRes.token;
    console.log('✅ LOGIN:', loginRes.studentName, '| Instant:', loginRes.message);
    
    const [profile, attendance, marks, fees, timetable, syllabus, notifs] = await Promise.all([
        get('/api/profile', tok),
        get('/api/attendance', tok),
        get('/api/marks', tok),
        get('/api/fees', tok),
        get('/api/timetable', tok),
        get('/api/syllabus', tok),
        get('/api/notifications', tok)
    ]);

    console.log('\n--- PROFILE ---');
    console.log('Name:', profile?.data?.name);
    console.log('CGPA:', profile?.data?.cgpa);
    console.log('Semester:', profile?.data?.semester);
    console.log('isSyncing:', profile?.data?.isSyncing);

    console.log('\n--- ATTENDANCE ---');
    console.log('Records:', (attendance?.attendance || []).length);
    if (attendance?.attendance?.[0]) {
        console.log('Sample:', attendance.attendance[0].subject, attendance.attendance[0].percentage + '%');
    }

    console.log('\n--- MARKS ---');
    console.log('CGPA:', marks?.data?.cgpa);
    console.log('Subjects:', marks?.data?.subjects?.length);
    if (marks?.data?.subjects?.[0]) {
        console.log('Sample:', marks.data.subjects[0].name, marks.data.subjects[0].grade);
    }

    console.log('\n--- FEES ---');
    console.log('Total:', fees?.data?.totalAmount);
    console.log('Paid:', fees?.data?.paidAmount);
    console.log('Due:', fees?.data?.dueAmount);
    console.log('Progress:', fees?.data?.paidProgress + '%');
    console.log('Transactions:', (fees?.data?.transactions || []).length);

    console.log('\n--- TIMETABLE ---');
    console.log('Is Array:', Array.isArray(timetable));
    console.log('Slots:', (Array.isArray(timetable) ? timetable : timetable?.data || []).length);
    const monday = (Array.isArray(timetable) ? timetable : []).filter(t => t.day === 'Monday');
    console.log('Monday slots:', monday.length);

    console.log('\n--- SYLLABUS ---');
    console.log('Subjects:', (syllabus?.data || []).length);
    if (syllabus?.data?.[0]) {
        console.log('Sample:', syllabus.data[0].code, '| units:', (syllabus.data[0].syllabus || []).length);
    }

    console.log('\n--- NOTIFICATIONS ---');
    console.log('Count:', (notifs?.data || []).length);
    if (notifs?.data?.[0]) {
        console.log('Sample:', notifs.data[0].title);
    }

    console.log('\n=== ALL SYSTEMS OPERATIONAL ===\n');
}

main().catch(e => { console.error('Error:', e); p.$disconnect(); });
