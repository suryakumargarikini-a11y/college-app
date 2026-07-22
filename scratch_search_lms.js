const fs = require('fs');
const path = require('path');

function walk(dir, results = []) {
    const list = fs.readdirSync(dir);
    list.forEach(file => {
        const fullPath = path.join(dir, file);
        const stat = fs.statSync(fullPath);
        if (stat && stat.isDirectory()) {
            if (!file.startsWith('.') && file !== 'node_modules') {
                walk(fullPath, results);
            }
        } else {
            if (file.endsWith('.js') || file.endsWith('.json')) {
                results.push(fullPath);
            }
        }
    });
    return results;
}

const jsFiles = walk('d:/111/backend');
console.log(`Found ${jsFiles.length} backend files.`);

jsFiles.forEach(file => {
    const content = fs.readFileSync(file, 'utf8');
    const lines = content.split('\n');
    let matchCount = 0;
    lines.forEach((line, idx) => {
        if (line.toLowerCase().includes('/lms') || line.toLowerCase().includes('lms')) {
            matchCount++;
            if (matchCount <= 5) {
                console.log(`${path.basename(file)}:${idx + 1} - ${line.trim()}`);
            }
        }
    });
});
