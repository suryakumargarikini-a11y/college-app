// ============================================================
// Ethereal Scholar ERP — Launcher
// Starts both backend (port 3001) and frontend (port 3000)
// Run with: npm start  (from d:\111)
// ============================================================

const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const RESET  = '\x1b[0m';
const CYAN   = '\x1b[36m';
const GREEN  = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED    = '\x1b[31m';
const BOLD   = '\x1b[1m';
const DIM    = '\x1b[2m';

function log(color, prefix, msg) {
    const time = new Date().toLocaleTimeString('en-IN', { hour12: false });
    console.log(`${DIM}[${time}]${RESET} ${color}${BOLD}[${prefix}]${RESET} ${msg}`);
}

// ---- Frontend static file server (no extra packages needed) ----
function startFrontend() {
    const MIME = {
        'html': 'text/html', 'js': 'application/javascript',
        'css': 'text/css', 'png': 'image/png', 'jpg': 'image/jpeg',
        'svg': 'image/svg+xml', 'ico': 'image/x-icon', 'json': 'application/json',
        'woff2': 'font/woff2', 'woff': 'font/woff', 'ttf': 'font/ttf'
    };

    const server = http.createServer((req, res) => {
        let urlPath = req.url === '/' ? '/index.html' : req.url.split('?')[0];
        const filePath = path.join(__dirname, 'frontend', urlPath);

        if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
            const ext = filePath.split('.').pop().toLowerCase();
            res.writeHead(200, {
                'Content-Type': MIME[ext] || 'text/plain',
                'Access-Control-Allow-Origin': '*',
                'Cache-Control': 'no-cache'
            });
            fs.createReadStream(filePath).pipe(res);
        } else {
            // SPA fallback — serve index.html for all unknown routes
            const indexPath = path.join(__dirname, 'frontend', 'index.html');
            res.writeHead(200, { 'Content-Type': 'text/html' });
            fs.createReadStream(indexPath).pipe(res);
        }
    });

    server.listen(3000, () => {
        log(GREEN, 'FRONTEND', `Running at ${BOLD}http://localhost:3000${RESET}`);
    });

    server.on('error', (e) => {
        if (e.code === 'EADDRINUSE') {
            log(YELLOW, 'FRONTEND', 'Port 3000 already in use — skipping');
        } else {
            log(RED, 'FRONTEND', 'Error: ' + e.message);
        }
    });
}

// ---- Backend (spawns node server.js in backend/) ----
function startBackend() {
    const backendDir = path.join(__dirname, 'backend');
    const proc = spawn('node', ['server.js'], {
        cwd: backendDir,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env }
    });

    proc.stdout.on('data', (data) => {
        data.toString().split('\n').filter(Boolean).forEach(line => {
            log(CYAN, 'BACKEND ', line.trim());
        });
    });

    proc.stderr.on('data', (data) => {
        data.toString().split('\n').filter(Boolean).forEach(line => {
            if (!line.includes('ExperimentalWarning') && !line.includes('punycode')) {
                log(RED, 'BACKEND ', line.trim());
            }
        });
    });

    proc.on('exit', (code) => {
        if (code !== 0 && code !== null) {
            log(RED, 'BACKEND ', `Exited with code ${code}. Restarting in 3s...`);
            setTimeout(startBackend, 3000);
        }
    });

    proc.on('error', (e) => {
        log(RED, 'BACKEND ', 'Failed to start: ' + e.message);
    });
}

// ---- Main ----
console.log('');
console.log(`${BOLD}${GREEN}  ╔══════════════════════════════════╗${RESET}`);
console.log(`${BOLD}${GREEN}  ║   Ethereal Scholar ERP           ║${RESET}`);
console.log(`${BOLD}${GREEN}  ║   Starting all services...       ║${RESET}`);
console.log(`${BOLD}${GREEN}  ╚══════════════════════════════════╝${RESET}`);
console.log('');

// Compile dynamic config before startup
try {
    require('./scripts/generate-config');
} catch (err) {
    console.error('Failed to compile config:', err);
}

startBackend();
startFrontend();

// ---- Wait then print access info ----
setTimeout(() => {
    console.log('');
    console.log(`${BOLD}  ┌─────────────────────────────────────────┐${RESET}`);
    console.log(`${BOLD}  │  🌐  Open in browser:                   │${RESET}`);
    console.log(`${BOLD}${GREEN}  │      http://localhost:3000              │${RESET}`);
    console.log(`${BOLD}  │  🔌  Backend API:                        │${RESET}`);
    console.log(`${BOLD}${CYAN}  │      http://localhost:3001/api/health   │${RESET}`);
    console.log(`${BOLD}  │                                          │${RESET}`);
    console.log(`${BOLD}  │  Press Ctrl+C to stop                    │${RESET}`);
    console.log(`${BOLD}  └─────────────────────────────────────────┘${RESET}`);
    console.log('');
}, 2500);

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n\nShutting down ERP...\n');
    process.exit(0);
});
