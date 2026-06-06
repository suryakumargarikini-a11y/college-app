const fs = require('fs');
const path = require('path');

const logPath = 'C:\\Users\\singl\\.gemini\\antigravity\\brain\\37668678-e3d9-4724-a2ad-5f803a0199ad\\.system_generated\\logs\\transcript.jsonl';

try {
    const content = fs.readFileSync(logPath, 'utf8');
    const lines = content.split('\n');
    
    // Find the line that invoked the subagents
    const targetLine = lines.find(l => l.includes('invoke_subagent') && l.includes('4168'));
    if (!targetLine) {
        console.error('Target line not found');
        process.exit(1);
    }
    
    // Parse the JSON line. To make it safe against unescaped control characters in JSON,
    // we can parse it carefully. Or let's see why it failed.
    // The Subagents property is a JSON string itself inside obj.tool_calls[0].args.Subagents.
    // If it contains literal newlines inside double quotes, it's invalid JSON, but it might be escaped.
    // Let's print the length of targetLine first and save it as a JSON file or use a regex to extract.
    
    const obj = JSON.parse(targetLine);
    const toolCall = obj.tool_calls.find(tc => tc.name === 'invoke_subagent');
    if (!toolCall) {
        console.error('No invoke_subagent tool call found in this line');
        process.exit(1);
    }
    
    let subagentsRaw = toolCall.args.Subagents;
    if (typeof subagentsRaw === 'string') {
        // Replace unescaped control characters like tab, newline, carriage return inside strings
        // Actually, JSON.parse can fail if there are real control characters.
        // Let's replace actual control characters or sanitize.
        const sanitized = subagentsRaw.replace(/[\u0000-\u001F]/g, (match) => {
            if (match === '\n') return '\\n';
            if (match === '\r') return '\\r';
            if (match === '\t') return '\\t';
            return '\\u' + ('0000' + match.charCodeAt(0).toString(16)).slice(-4);
        });
        const subagents = JSON.parse(sanitized);
        subagents.forEach((s, idx) => {
            const outPath = path.join(__dirname, 'subagent_prompt_' + idx + '.txt');
            fs.writeFileSync(outPath, s.Prompt, 'utf8');
            console.log(`Extracted prompt ${idx} (${s.TypeName} / ${s.Role}) to ${outPath}`);
        });
    } else {
        const subagents = subagentsRaw;
        subagents.forEach((s, idx) => {
            const outPath = path.join(__dirname, 'subagent_prompt_' + idx + '.txt');
            fs.writeFileSync(outPath, s.Prompt, 'utf8');
            console.log(`Extracted prompt ${idx} (${s.TypeName} / ${s.Role}) to ${outPath}`);
        });
    }
} catch (err) {
    console.error('Error parsing transcript:', err);
}
