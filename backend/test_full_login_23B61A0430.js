const fetch = require('node-fetch');

async function verifyLoginFlow() {
    const userId = '23B61A0430';
    console.log('================================================================');
    console.log(`[LOGIN-AUDIT] EMPIRICAL BACKEND LOGIN TRACE FOR STUDENT: ${userId}`);
    console.log('================================================================');

    const overallStart = Date.now();

    // Stage 1: Measure HTTP Request & Response Time
    console.log('\n[STAGE 1] Sending POST /api/auth/login request...');
    const t0 = Date.now();

    try {
        const response = await fetch('http://localhost:8080/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                userId: userId,
                password: 'password123'
            })
        });

        const roundtripMs = Date.now() - t0;
        console.log(`[STAGE 1 COMPLETED] HTTP Status: ${response.status} ${response.statusText} (${roundtripMs}ms)`);

        const data = await response.json();
        const totalMs = Date.now() - overallStart;

        console.log('\n================================================================');
        console.log('                 LOGIN DIAGNOSTIC METRICS                       ');
        console.log('================================================================');
        console.log(`Total Login Time:         ${totalMs}ms`);
        console.log(`HTTP Status Code:         ${response.status}`);
        console.log(`Success Flag:             ${data.success}`);
        console.log(`Student Name:             ${data.studentName || 'N/A'}`);
        console.log(`Session Token Generated:  ${data.token ? 'YES (' + data.token.substring(0, 20) + '...)' : 'NO'}`);
        console.log(`Server Response Message:  "${data.message || ''}"`);
        console.log(`Timestamp:                ${data.timestamp}`);
        console.log('================================================================\n');

        if (totalMs <= 10000) {
            console.log(`✅ VERIFICATION SUCCESSFUL: Total login time (${totalMs}ms) is strictly within 10 seconds boundary.`);
        } else {
            console.error(`❌ VERIFICATION FAILED: Total login time (${totalMs}ms) exceeded 10 seconds.`);
        }

    } catch (err) {
        console.error(`❌ VERIFICATION FAILED with error: ${err.message}`);
    }
}

verifyLoginFlow().catch(console.error);
