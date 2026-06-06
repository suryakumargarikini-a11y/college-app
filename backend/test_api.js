const axios = require('axios');
const API = 'http://localhost:3001/api';

async function test() {
  console.log('=== LOGIN ===');
  const login = await axios.post(`${API}/auth/login`, { userId: '25B61A0596', password: 'webcap' }, { timeout: 60000 });
  console.log('Login:', login.data.success, 'Token:', login.data.token);
  const token = login.data.token;
  const h = { Authorization: `Bearer ${token}` };

  console.log('\n=== PROFILE ===');
  try {
    const p = await axios.get(`${API}/profile`, { headers: h, timeout: 30000 });
    console.log(JSON.stringify(p.data, null, 2));
  } catch (e) { console.log('Profile err:', e.response?.status, e.response?.data); }

  console.log('\n=== MARKS ===');
  try {
    const m = await axios.get(`${API}/marks`, { headers: h, timeout: 30000 });
    console.log(JSON.stringify(m.data, null, 2));
  } catch (e) { console.log('Marks err:', e.response?.status, e.response?.data); }

  console.log('\n=== ATTENDANCE ===');
  try {
    const a = await axios.get(`${API}/attendance`, { headers: h, timeout: 30000 });
    console.log(JSON.stringify(a.data, null, 2));
  } catch (e) { console.log('Attendance err:', e.response?.status, e.response?.data); }

  console.log('\n=== FEES ===');
  try {
    const f = await axios.get(`${API}/fees`, { headers: h, timeout: 30000 });
    console.log(JSON.stringify(f.data, null, 2));
  } catch (e) { console.log('Fees err:', e.response?.status, e.response?.data); }

  console.log('\nDone!');
}

test().catch(e => console.error('FATAL:', e.message));
