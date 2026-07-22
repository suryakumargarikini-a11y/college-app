const fs = require('fs');

const content = fs.readFileSync('d:/111/backend/prisma/seed-demo.js', 'utf8');
const lines = content.split('\n');

console.log("Searching for LMS in seed-demo.js...");
let matches = 0;
lines.forEach((line, idx) => {
    if (line.includes('LMS') || line.includes('Course') || line.includes('Enrollment') || line.includes('Certificate')) {
        matches++;
        if (matches <= 50) {
            console.log(`${idx + 1}: ${line.trim()}`);
        }
    }
});
console.log(`Total matches: ${matches}`);
