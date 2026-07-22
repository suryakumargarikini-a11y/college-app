const fs = require('fs');

const content = fs.readFileSync('d:/111/frontend/app.js', 'utf8');
const lines = content.split('\n');

const queries = ['nav', 'link', 'dock', 'active'];

queries.forEach(q => {
    console.log(`Searching for "${q}" (case insensitive) in app.js...`);
    let matches = 0;
    lines.forEach((line, idx) => {
        if (line.toLowerCase().includes(q)) {
            matches++;
            if (matches <= 5) {
                console.log(`${idx + 1}: ${line.trim()}`);
            }
        }
    });
    console.log(`Total matches for "${q}": ${matches}`);
    console.log("--------------------------------------");
});
