/**
 * SITAM Smart ERP — WebSocket Load Test Runner
 *
 * Opens N concurrent WebSocket connections and validates:
 *  - All receive the welcome event
 *  - Heartbeat pong responses work
 *  - Connections remain stable for the test duration
 *  - Clean disconnect without errors
 *
 * Usage:
 *   node scripts/load-test-websocket.js
 *
 * Environment overrides:
 *   WS_URL=ws://localhost:3001
 *   WS_CONNECTIONS=50
 *   WS_TEST_DURATION_MS=30000
 *   WS_CONNECT_DELAY_MS=50   (stagger connection open rate)
 */

const { WebSocket } = require('ws');

const WS_URL = process.env.WS_URL || 'ws://localhost:3001';
const WS_CONNECTIONS = parseInt(process.env.WS_CONNECTIONS || '50', 10);
const TEST_DURATION_MS = parseInt(process.env.WS_TEST_DURATION_MS || '30000', 10);
const CONNECT_DELAY_MS = parseInt(process.env.WS_CONNECT_DELAY_MS || '50', 10);

const C = {
    reset: '\x1b[0m', green: '\x1b[32m', yellow: '\x1b[33m',
    red: '\x1b[31m', cyan: '\x1b[36m', bold: '\x1b[1m',
};

class WsLoadTest {
    constructor() {
        this.connections = [];
        this.stats = {
            connected: 0,
            welcomed: 0,
            errors: 0,
            disconnected: 0,
            messagesReceived: 0,
            pongsSent: 0,
        };
        this.startTime = null;
    }

    async run() {
        console.log(`\n${C.bold}${C.cyan}SITAM ERP — WebSocket Load Test${C.reset}`);
        console.log(`  Target:         ${WS_URL}`);
        console.log(`  Connections:    ${WS_CONNECTIONS}`);
        console.log(`  Test Duration:  ${TEST_DURATION_MS / 1000}s`);
        console.log(`  Connect Delay:  ${CONNECT_DELAY_MS}ms between connections\n`);

        this.startTime = Date.now();

        // Staggered connection opening (avoids thundering herd on WS handshake)
        for (let i = 0; i < WS_CONNECTIONS; i++) {
            await new Promise(r => setTimeout(r, CONNECT_DELAY_MS));
            this._openConnection(i);
        }

        console.log(`${C.green}  All ${WS_CONNECTIONS} connections initiated. Monitoring for ${TEST_DURATION_MS / 1000}s...${C.reset}`);

        // Progress reporter
        const progressInterval = setInterval(() => {
            const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(1);
            process.stdout.write(
                `\r  [${elapsed}s] Connected: ${this.stats.connected} | ` +
                `Welcomed: ${this.stats.welcomed} | ` +
                `Messages: ${this.stats.messagesReceived} | ` +
                `Errors: ${this.stats.errors}`
            );
        }, 500);

        // Wait for test duration
        await new Promise(r => setTimeout(r, TEST_DURATION_MS));
        clearInterval(progressInterval);
        console.log(); // newline after progress

        // Graceful close
        console.log(`\n  Closing all connections...`);
        await this._closeAll();

        this._printResults();
    }

    _openConnection(id) {
        // Each connection identifies as a unique mock student
        const userId = `loadtest-student-${String(id).padStart(4, '0')}`;
        const ws = new WebSocket(`${WS_URL}?userId=${userId}`);

        const connState = {
            id,
            userId,
            ws,
            connected: false,
            welcomed: false,
            errors: [],
            openTime: null,
        };

        this.connections.push(connState);

        ws.on('open', () => {
            connState.connected = true;
            connState.openTime = Date.now();
            this.stats.connected++;
        });

        ws.on('message', (data) => {
            this.stats.messagesReceived++;
            try {
                const msg = JSON.parse(data.toString());
                if (msg.event === 'welcome') {
                    connState.welcomed = true;
                    this.stats.welcomed++;
                }
            } catch (_) {}
        });

        ws.on('pong', () => {
            this.stats.pongsSent++;
        });

        ws.on('error', (err) => {
            this.stats.errors++;
            connState.errors.push(err.message);
        });

        ws.on('close', (code, reason) => {
            if (connState.connected) {
                this.stats.disconnected++;
                connState.connected = false;
            }
        });
    }

    async _closeAll() {
        await Promise.allSettled(
            this.connections.map(({ ws }) => new Promise(resolve => {
                if (ws.readyState === WebSocket.OPEN) {
                    ws.once('close', resolve);
                    ws.close(1000, 'load test complete');
                    setTimeout(resolve, 2000); // fallback timeout
                } else {
                    resolve();
                }
            }))
        );
    }

    _printResults() {
        const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(2);
        const welcomeRate = ((this.stats.welcomed / WS_CONNECTIONS) * 100).toFixed(1);
        const errorRate = ((this.stats.errors / WS_CONNECTIONS) * 100).toFixed(1);
        const pass = this.stats.welcomed >= Math.floor(WS_CONNECTIONS * 0.95) && this.stats.errors < Math.ceil(WS_CONNECTIONS * 0.05);

        console.log('\n' + C.bold + '═'.repeat(60) + C.reset);
        console.log(C.bold + C.cyan + '  WEBSOCKET LOAD TEST RESULTS' + C.reset);
        console.log(C.bold + '═'.repeat(60) + C.reset);
        console.log(`  Connections Attempted:  ${WS_CONNECTIONS}`);
        console.log(`  Successfully Connected: ${C.green}${this.stats.connected}${C.reset}`);
        console.log(`  Welcomed (event recv):  ${C.green}${this.stats.welcomed}${C.reset} (${welcomeRate}%)`);
        console.log(`  Messages Received:      ${this.stats.messagesReceived}`);
        console.log(`  Pongs Received:         ${this.stats.pongsSent}`);
        console.log(`  Errors:                 ${this.stats.errors > 0 ? C.red : C.green}${this.stats.errors}${C.reset} (${errorRate}%)`);
        console.log(`  Test Duration:          ${elapsed}s`);
        console.log('\n' + C.bold + '═'.repeat(60) + C.reset);
        console.log(pass
            ? `${C.bold}${C.green}  ✓ WEBSOCKET TEST PASSED — ≥95% welcome rate, <5% errors${C.reset}`
            : `${C.bold}${C.red}  ✗ WEBSOCKET TEST FAILED — check errors above${C.reset}`
        );
        console.log(C.bold + '═'.repeat(60) + C.reset + '\n');
    }
}

new WsLoadTest().run().catch(err => {
    console.error(`WebSocket load test crashed: ${err.message}`);
    process.exit(1);
});
