const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
console.log('DATABASE_URL from backend/.env:', process.env.DATABASE_URL);
