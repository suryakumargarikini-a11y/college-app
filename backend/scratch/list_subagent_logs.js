const fs = require('fs');
const path = require('path');

const brainDir = 'C:\\Users\\singl\\.gemini\\antigravity\\brain';

try {
    const items = fs.readdirSync(brainDir);
    console.log(`Found ${items.length} folders in brain directory:\n`);
    
    for (const item of items) {
        const fullPath = path.join(brainDir, item);
        if (fs.statSync(fullPath).isDirectory()) {
            const transcriptPath = path.join(fullPath, '.system_generated', 'logs', 'transcript.jsonl');
            if (fs.existsSync(transcriptPath)) {
                // Read last few lines of transcript.jsonl
                const content = fs.readFileSync(transcriptPath, 'utf8');
                const lines = content.trim().split('\n');
                const lastLineStr = lines[lines.length - 1];
                let lastMsg = 'No message';
                let lastType = '';
                let lastTime = '';
                try {
                    const parsed = JSON.parse(lastLineStr);
                    lastType = parsed.type;
                    lastTime = parsed.created_at;
                    if (parsed.content) {
                        lastMsg = parsed.content.substring(0, 200).replace(/\n/g, ' ');
                    } else if (parsed.tool_calls) {
                        lastMsg = `Tool Call: ${parsed.tool_calls.map(tc => tc.name).join(', ')}`;
                    }
                } catch (e) {
                    lastMsg = lastLineStr.substring(0, 200);
                }
                
                // Let's also check if there is an agent.json or similar to identify the subagent
                let agentRole = 'Unknown';
                const agentJsonPath = path.join(fullPath, '.agents', 'agents', 'file-writer', 'agent.json');
                const agentJsonPathAlt = path.join(fullPath, '.agents', 'agent.json');
                if (fs.existsSync(agentJsonPath)) {
                    try {
                        const agent = JSON.parse(fs.readFileSync(agentJsonPath, 'utf8'));
                        agentRole = agent.role || agent.name || 'Unknown';
                    } catch (e) {}
                } else if (fs.existsSync(agentJsonPathAlt)) {
                    try {
                        const agent = JSON.parse(fs.readFileSync(agentJsonPathAlt, 'utf8'));
                        agentRole = agent.role || agent.name || 'Unknown';
                    } catch (e) {}
                }
                
                console.log(`Folder: ${item}`);
                console.log(`  Role: ${agentRole}`);
                console.log(`  Last Event: [${lastType}] at ${lastTime}`);
                console.log(`  Last Message: ${lastMsg}`);
                console.log('---');
            }
        }
    }
} catch (err) {
    console.error('Error:', err);
}
