'use strict';
const axios = require('axios');

async function testProdStatus() {
    const url = 'https://web-production-259f33.up.railway.app/api/sre/status';
    console.log('Sending SRE status request to:', url);
    try {
        const response = await axios.get(url, {
            headers: {
                'x-sre-role': 'operator'
            }
        });
        console.log('Production SRE status success!');
        console.log('Response data:', JSON.stringify(response.data, null, 2));
    } catch (err) {
        console.error('Production SRE status failed!');
        if (err.response) {
            console.error('Status:', err.response.status);
            console.error('Data:', JSON.stringify(err.response.data));
        } else {
            console.error('Error message:', err.message);
        }
    }
}

testProdStatus();
