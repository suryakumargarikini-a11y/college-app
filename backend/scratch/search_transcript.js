const fs = require('fs');
const readline = require('readline');
const path = require('path');

const logPath = 'C:\\Users\\singl\\.gemini\\antigravity\\brain\\37668678-e3d9-4724-a2ad-5f803a0199ad\\.system_generated\\logs\\transcript.jsonl';

async function search() {
    const fileStream = fs.createReadStream(logPath);
    const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity
    });

    let lineNum = 0;
    for await (const line of rl) {
        lineNum++;
        if (line.includes('Verification 1') || line.includes('Verification 2') || line.includes('stress test') || line.includes('Stress Test') || line.includes('Verify the remaining two fixes')) {
            console.log(`Line ${lineNum}: ${line.slice(0, 500)}...`);
        }
    }
}

search().catch(console.error);
