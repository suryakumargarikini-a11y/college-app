'use strict';
const axios = require('axios');

async function testProdLogin() {
    const url = 'https://college-app-bx6b.onrender.com/api/admin/auth/login';
    console.log('Sending login request to:', url);
    try {
        const response = await axios.post(url, {
            email: 'admin@sitamecap.co.in',
            password: 'Admin@SITAM2024'
        });
        console.log('Production login success!');
        console.log('Response status:', response.status);
        console.log('Response data:', response.data);
    } catch (err) {
        console.error('Production login failed!');
        if (err.response) {
            console.error('Status:', err.response.status);
            console.error('Data:', JSON.stringify(err.response.data));
        } else {
            console.error('Error message:', err.message);
        }
    }
}

testProdLogin();
