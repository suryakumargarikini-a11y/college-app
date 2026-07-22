const fs = require('fs');

const content = fs.readFileSync('d:/111/backend/prisma/schema.prisma', 'utf8');
const lines = content.split('\n');

console.log("Searching schema.prisma...");
lines.forEach((line, idx) => {
    if (line.includes('model ') || line.includes('Course') || line.includes('Enrollment') || line.includes('Lms') || line.includes('Progress') || line.includes('Certificate')) {
        console.log(`${idx + 1}: ${line.trim()}`);
    }
});
