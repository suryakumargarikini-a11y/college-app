const fs = require('fs');
const path = require('path');

const brainDir = 'C:\\Users\\singl\\.gemini\\antigravity\\brain';

try {
    const items = fs.readdirSync(brainDir);
    for (const item of items) {
        const fullPath = path.join(brainDir, item);
        if (fs.statSync(fullPath).isDirectory()) {
            const transcriptPath = path.join(fullPath, '.system_generated', 'logs', 'transcript.jsonl');
            if (fs.existsSync(transcriptPath)) {
                const content = fs.readFileSync(transcriptPath, 'utf8');
                const lines = content.trim().split('\n');
                
                // Let's filter for folders whose last activity is recent (since June 6, 2026)
                const lastLineStr = lines[lines.length - 1];
                let isRecent = false;
                try {
                    const parsed = JSON.parse(lastLineStr);
                    if (parsed.created_at && parsed.created_at.startsWith('2026-06-06')) {
                        isRecent = true;
                    }
                } catch (e) {}
                
                if (isRecent && item !== '37668678-e3d9-4724-a2ad-5f803a0199ad') {
                    console.log(`==================================================`);
                    console.log(`Subagent Folder: ${item}`);
                    console.log(`==================================================`);
                    
                    // Print last 10 lines of the transcript to see the recent steps
                    const tailLines = lines.slice(-10);
                    tailLines.forEach(l => {
                        try {
                            const parsed = JSON.parse(l);
                            let contentSummary = parsed.content ? parsed.content.substring(0, 150) : '';
                            if (parsed.tool_calls) {
                                contentSummary = `Calls: ${parsed.tool_calls.map(tc => tc.name).join(', ')}`;
                            }
                            console.log(`Step ${parsed.step_index} [${parsed.type}] at ${parsed.created_at}: ${contentSummary}`);
                        } catch (e) {
                            console.log(`Unparseable line: ${l.substring(0, 150)}`);
                        }
                    });
                    console.log('\n');
                }
            }
        }
    }
} catch (err) {
    console.error('Error:', err);
}
