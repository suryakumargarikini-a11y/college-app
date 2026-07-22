const fs = require('fs');

const content = fs.readFileSync('d:/111/frontend/app.js', 'utf8');
const lines = content.split('\n');

const query = 'router';
console.log(`Searching for "${query}" in app.js...`);
let matches = 0;
lines.forEach((line, idx) => {
    if (line.includes(query)) {
        matches++;
        if (matches <= 50) {
            console.log(`${idx + 1}: ${line.trim()}`);
        }
    }
});
console.log(`Total matches: ${matches}`);
