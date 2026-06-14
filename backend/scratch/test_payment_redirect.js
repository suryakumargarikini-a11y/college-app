const axios = require('axios');

async function runTest() {
    try {
        console.log('Sending login request to backend...');
        const loginRes = await axios.post('http://localhost:3001/api/auth/login', {
            userId: '25B61A0596',
            password: 'webcap'
        });

        if (!loginRes.data.success) {
            console.error('Login failed:', loginRes.data);
            process.exit(1);
        }

        const token = loginRes.data.token;
        console.log(`Successfully logged in. Token: ${token}`);

        console.log('Requesting payment redirect endpoint...');
        const redirectRes = await axios.get(`http://localhost:3001/api/fees/payment-redirect?token=${encodeURIComponent(token)}`);

        console.log(`Response Status: ${redirectRes.status}`);
        console.log(`Content-Type: ${redirectRes.headers['content-type']}`);
        
        const html = redirectRes.data;
        console.log('\n--- First 20 lines of HTML response ---');
        console.log(html.split('\n').slice(0, 20).join('\n'));
        console.log('---------------------------------------\n');

        // Verify key requirements in the HTML response
        const containsForm = html.includes('<form id="loginForm"');
        const containsUserId = html.includes('name="txtId2" value="25B61A0596"');
        const containsEncryptedPwd = html.includes('name="txtPwd2" value="');
        const containsViewState = html.includes('name="__VIEWSTATE"');
        const containsIframe = html.includes('<iframe name="loginIframe"');

        console.log('Verification Checks:');
        console.log(`- Contains Login Form: ${containsForm ? 'PASS' : 'FAIL'}`);
        console.log(`- Contains student ID (25B61A0596): ${containsUserId ? 'PASS' : 'FAIL'}`);
        console.log(`- Contains encrypted password: ${containsEncryptedPwd ? 'PASS' : 'FAIL'}`);
        console.log(`- Contains __VIEWSTATE: ${containsViewState ? 'PASS' : 'FAIL'}`);
        console.log(`- Contains iframe target: ${containsIframe ? 'PASS' : 'FAIL'}`);

        if (containsForm && containsUserId && containsEncryptedPwd && containsViewState && containsIframe) {
            console.log('\nResult: ALL CHECKS PASSED SUCCESSFULY!');
        } else {
            console.error('\nResult: SOME CHECKS FAILED!');
            process.exit(1);
        }
    } catch (error) {
        console.error('Test execution failed:', error.message);
        if (error.response) {
            console.error('Response Status:', error.response.status);
            console.error('Response Data:', error.response.data);
        }
        process.exit(1);
    }
}

runTest();
