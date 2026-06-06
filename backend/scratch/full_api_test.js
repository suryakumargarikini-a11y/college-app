const http = require('http');

function post(path, body, cb) {
    const d = JSON.stringify(body);
    const opts = { hostname: 'localhost', port: 3001, path, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(d) } };
    const r = http.request(opts, res => { let data = ''; res.on('data', c => data += c); res.on('end', () => cb(null, data)); });
    r.on('error', cb); r.write(d); r.end();
}
function get(path, token, cb) {
    const opts = { hostname: 'localhost', port: 3001, path, headers: { 'Authorization': 'Bearer ' + token } };
    const r = http.request(opts, res => { let data = ''; res.on('data', c => data += c); res.on('end', () => cb(null, data)); });
    r.on('error', cb); r.end();
}

const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

async function main() {
    const s = await p.student.findUnique({ where: { userId: '25B61A0596' } });
    await p.$disconnect();
    if (!s) { console.log('No student in DB'); return; }

    const pwd = s.password;
    console.log('Testing login with stored credentials...');

    post('/api/auth/login', { userId: '25B61A0596', password: pwd }, (e, d) => {
        if (e) { console.log('Login error:', e.message); return; }
        const res = JSON.parse(d);
        if (!res.success) { console.log('LOGIN FAIL:', res.message); return; }
        console.log('✅ LOGIN OK - Name:', res.studentName, '| Token:', res.token.slice(-10));
        const tok = res.token;

        get('/api/attendance', tok, (e, d) => {
            const r = JSON.parse(d);
            console.log('✅ ATTENDANCE: count=' + (r.attendance || []).length + ' | first:', r.attendance?.[0]?.subject, r.attendance?.[0]?.percentage + '%');
        });
        get('/api/fees', tok, (e, d) => {
            const r = JSON.parse(d);
            console.log('✅ FEES: due=' + r.data?.dueAmount + ' | paid=' + r.data?.paidAmount + ' | pct=' + r.data?.paidProgress + '%');
        });
        get('/api/marks', tok, (e, d) => {
            const r = JSON.parse(d);
            console.log('✅ MARKS: cgpa=' + r.data?.cgpa + ' | subjects=' + r.data?.subjects?.length + ' | first:', r.data?.subjects?.[0]?.name, r.data?.subjects?.[0]?.grade);
        });
        get('/api/timetable', tok, (e, d) => {
            const r = JSON.parse(d);
            const arr = Array.isArray(r) ? r : (r.data || []);
            console.log('✅ TIMETABLE: isArray=' + Array.isArray(r) + ' | count=' + arr.length + ' | first:', arr[0]?.day, arr[0]?.subjectName);
        });
        get('/api/profile', tok, (e, d) => {
            const r = JSON.parse(d);
            console.log('✅ PROFILE: name=' + r.data?.name + ' | cgpa=' + r.data?.cgpa + ' | semester=' + r.data?.semester);
        });
        get('/api/notifications', tok, (e, d) => {
            const r = JSON.parse(d);
            console.log('✅ NOTIFICATIONS: count=' + (r.data || []).length + ' | first:', r.data?.[0]?.title);
        });
        get('/api/syllabus', tok, (e, d) => {
            const r = JSON.parse(d);
            console.log('✅ SYLLABUS: subjects=' + (r.data || []).length + ' | first:', r.data?.[0]?.code, 'units=' + (r.data?.[0]?.syllabus?.length || 0));
        });
    });
}

main().catch(e => { console.error('Error:', e.message); p.$disconnect(); });
