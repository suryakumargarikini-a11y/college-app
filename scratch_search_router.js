const fs = require('fs');

const content = fs.readFileSync('d:/111/frontend/app.js', 'utf8');
const lines = content.split('\n');

console.log("Searching for router declaration...");
lines.forEach((line, idx) => {
    if (line.includes('router =') || line.includes('var router') || line.includes('const router') || line.includes('let router')) {
        console.log(`${idx + 1}: ${line.trim()}`);
    }
});
