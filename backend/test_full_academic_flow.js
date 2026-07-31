const sessionManager = require('./services/sessionManager');
const fetch = require('node-fetch');

async function testFlow() {
    console.log('--- STEP 1: GENERATING TEST TOKEN FOR 23B61A0449 ---');
    const token = sessionManager.createSession('23B61A0449', 'dummyPass', 'mock_cookie', { studentName: 'TEST STUDENT' }, 'STUDENT', false);
    console.log('Generated Bearer Token (length):', token.length);

    console.log('\n--- STEP 2: FETCHING GET http://localhost:8080/api/student/results ---');
    const res = await fetch('http://localhost:8080/api/student/results', {
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        }
    });

    console.log('HTTP Status:', res.status);
    const data = await res.json();
    console.log('\n--- STEP 1 COMPLETE JSON RESPONSE ---');
    console.log(JSON.stringify(data, null, 2));

    console.log('\n--- VERIFICATION OF SEMESTERS ---');
    const semesters = data.semesters || data.data?.semesters || [];
    console.log('Total Semesters Returned:', semesters.length);
    semesters.forEach((sem, idx) => {
        console.log(`[Sem ${idx + 1}] Code: ${sem.semester} | Title: "${sem.semesterName}" | SGPA: ${sem.sgpa} | Subjects: ${sem.subjects ? sem.subjects.length : 0}`);
    });

    console.log('\n--- OVERALL SUMMARY ---');
    console.log('CGPA:', data.overall?.cgpa || data.cgpa);
    console.log('Percentage:', data.overall?.percentage || data.percentage);
    console.log('Total Credits:', data.overall?.totalCredits || data.totalCredits);
}

testFlow().catch(console.error);
