const fs = require('fs');
const readline = require('readline');

const logPath = 'C:\\Users\\singl\\.gemini\\antigravity\\brain\\37668678-e3d9-4724-a2ad-5f803a0199ad\\.system_generated\\logs\\transcript.jsonl';

async function extractLine() {
    const fileStream = fs.createReadStream(logPath);
    const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity
    });

    let lineNum = 0;
    for await (const line of rl) {
        lineNum++;
        if (lineNum === 14703) {
            const data = JSON.parse(line);
            console.log("=== USER REQUEST CONTENT ===");
            console.log(data.content);
            console.log("============================");
            break;
        }
    }
}

extractLine().catch(console.error);
