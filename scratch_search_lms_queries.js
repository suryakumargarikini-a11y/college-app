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
            if (file.endsWith('.js')) {
                results.push(fullPath);
            }
        }
    });
    return results;
}

const files = walk('d:/111/backend');
files.forEach(file => {
    const content = fs.readFileSync(file, 'utf8');
    const lines = content.split('\n');
    lines.forEach((line, idx) => {
        if (line.includes('courseEnrollment') || line.includes('certificate') || line.includes('lmsAssignment') || line.includes('lmsQuiz')) {
            console.log(`${path.basename(file)}:${idx + 1} - ${line.trim()}`);
        }
    });
});
