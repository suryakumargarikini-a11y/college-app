const fs = require('fs');
const path = require('path');

function walk(dir) {
    const list = fs.readdirSync(dir);
    for (const file of list) {
        const fullPath = path.join(dir, file);
        const stat = fs.statSync(fullPath);
        if (stat && stat.isDirectory()) {
            if (!file.startsWith('.') && file !== 'node_modules') {
                const res = walk(fullPath);
                if (res) return res;
            }
        } else {
            if (file === 'seed-demo.js') {
                return fullPath;
            }
        }
    }
    return null;
}

console.log("Searching for seed-demo.js...");
const result = walk('d:/111');
console.log(`Result: ${result}`);
