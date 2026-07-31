const fetch = require('node-fetch');

async function testLogin23B61A0430() {
    const regNo = '23B61A0430';
    console.log('================================================================');
    console.log(`[LOGIN-TRACE] TESTING BACKEND LOGIN FLOW FOR REGISTRATION: ${regNo}`);
    console.log('================================================================');

    const start = Date.now();
    const step = (msg) => {
        const elapsed = Date.now() - start;
        console.log(`[LOGIN-TRACE][+${elapsed}ms] ${msg}`);
    };

    step('1. Initiating HTTP POST request to http://localhost:8080/api/auth/login');

    try {
        const response = await fetch('http://localhost:8080/api/auth/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                userId: regNo,
                password: 'dummyPassword'
            })
        });

        step(`2. Received HTTP response. Status: ${response.status} ${response.statusText}`);
        const data = await response.json();
        step(`3. Parsed JSON response in ${Date.now() - start}ms total`);

        console.log('\n--- RESPONSE PAYLOAD ---');
        console.log(JSON.stringify(data, null, 2));

        console.log('\n--- TIMING DIAGNOSTIC SUMMARY ---');
        console.log(`Total Login Time: ${Date.now() - start}ms`);
        console.log(`HTTP Status: ${response.status}`);
        console.log(`Success Flag: ${data.success}`);
        if (data.token) console.log(`JWT Token Generated: ${data.token.substring(0, 15)}...`);
    } catch (err) {
        step(`✗ Request failed with exception: ${err.message}`);
        console.error(err);
    }
}

testLogin23B61A0430().catch(console.error);
