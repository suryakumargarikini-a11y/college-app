const fs = require('fs');
const path = require('path');

const logPath = 'C:\\Users\\singl\\.gemini\\antigravity-ide\\brain\\177a20a3-368d-4cc3-bcad-e8036ea6cc2a\\.system_generated\\logs\\transcript.jsonl';

if (!fs.existsSync(logPath)) {
    console.error('Log file does not exist:', logPath);
    process.exit(1);
}

const content = fs.readFileSync(logPath, 'utf8');
const lines = content.split('\n');

console.log('Searching for DATABASE_URL or postgres in transcript...');

lines.forEach((line, index) => {
    if (line.includes('DATABASE_URL') || line.includes('college_app')) {
        console.log(`\n--- Line ${index + 1} ---`);
        const clean = line.substring(0, 1000); // Truncate long lines to avoid flooding
        console.log(clean);
    }
});
