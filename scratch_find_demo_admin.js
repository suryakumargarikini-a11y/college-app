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
            if (file === 'demo.js') {
                results.push(fullPath);
            }
        }
    });
    return results;
}

console.log(walk('d:/111'));
