const fs = require('fs');
const path = require('path');

const taskPath = 'C:\\Users\\singl\\.gemini\\antigravity\\brain\\37668678-e3d9-4724-a2ad-5f803a0199ad\\task.md';
const workspaceDir = 'd:/111';

try {
    const taskContent = fs.readFileSync(taskPath, 'utf8');
    const lines = taskContent.split('\n');
    
    console.log('Checking files from task.md:\n');
    
    for (const line of lines) {
        // Find lines like: - `[ ]` `security/sbom/SBOMGenerator.js` or - `[ ]` Extend `monitoring/grafana/dashboards/platform-command-center.json`
        const match = line.match(/-\s+`\[\s*\]`\s+(Extend\s+)?`([^`]+)`/);
        if (match) {
            const relPath = match[2];
            const fullPath = path.join(workspaceDir, 'backend', relPath);
            const exists = fs.existsSync(fullPath);
            console.log(`[${exists ? 'X' : ' '}] ${relPath} (${exists ? 'Exists' : 'Missing'})`);
        }
    }
} catch (err) {
    console.error('Error:', err);
}
