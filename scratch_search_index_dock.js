const fs = require('fs');

const content = fs.readFileSync('d:/111/frontend/index.html', 'utf8');
const lines = content.split('\n');

console.log("Searching for bottom dock / navigation references in index.html...");
lines.forEach((line, idx) => {
    if (line.includes('dock') || line.includes('navigation') || line.includes('nav-item') || line.includes('bottom-nav') || line.includes('data-nav')) {
        console.log(`${idx + 1}: ${line.trim()}`);
    }
});
