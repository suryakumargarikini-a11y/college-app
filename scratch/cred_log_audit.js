/**
 * SITAM ERP — Expanded Credential Logging Audit (P0-5)
 * Searches for: Authorization, Bearer, token:, accessToken, refreshToken,
 * sessionToken, jwt, password, req.headers, req.body, JSON.stringify(req, FEES-FLOW
 *
 * Output: classified list of every hit — REMOVE / KEEP / SAFE
 */

const fs = require('fs');
const path = require('path');

const SKIP_DIRS = new Set(['node_modules', '.git', 'android', 'scratch', 'zip_extract_temp', 'node', 'dist', 'build']);
const SKIP_FILES = new Set(['find_jwt_paths.js', 'security_scan.js']); // skip our own scripts

const results = [];

// Patterns that indicate sensitive credential data in a log line
// A "log line" is one that contains console.log/warn/error OR logger.info/warn/error/debug
const SENSITIVE_PATTERNS = [
    // Full token/credential values
    { re: /\btoken\b(?!.*(present|length|type|count|prefix|hash|created|found|valid|fcm|push|device|limit|refresh.*false|color))/i, label: 'TOKEN_VALUE', severity: 'HIGH' },
    { re: /accessToken|refreshToken|sessionToken/i, label: 'AUTH_TOKEN_NAMED', severity: 'HIGH' },
    { re: /Authorization/i, label: 'AUTH_HEADER', severity: 'HIGH' },
    { re: /Bearer/i, label: 'BEARER_KEYWORD', severity: 'HIGH' },
    { re: /\bjwt\b/i, label: 'JWT_KEYWORD', severity: 'MEDIUM' },
    { re: /\bpassword\b/i, label: 'PASSWORD', severity: 'HIGH' },
    { re: /req\.headers/i, label: 'REQ_HEADERS_IN_LOG', severity: 'HIGH' },
    { re: /JSON\.stringify\(req/i, label: 'REQ_SERIALIZED', severity: 'HIGH' },
    { re: /FEES-FLOW/i, label: 'FEES_FLOW_DIAGNOSTIC', severity: 'HIGH' },
    { re: /req\.body/i, label: 'REQ_BODY_IN_LOG', severity: 'MEDIUM' },
    { re: /cookie/i, label: 'COOKIE', severity: 'MEDIUM' },
    { re: /tokenPrefix|token\.sub/i, label: 'TOKEN_PREFIX_PARTIAL', severity: 'LOW' },
];

// Lines that contain a logging call
const LOG_CALL_RE = /console\.(log|warn|error|info|debug)|logger\.(info|warn|error|debug|log)/;

function classifyLine(line) {
    const t = line.trim();
    if (!LOG_CALL_RE.test(t)) return null;
    // skip comment lines
    if (t.startsWith('//') || t.startsWith('*') || t.startsWith('#')) return null;

    for (const p of SENSITIVE_PATTERNS) {
        if (p.re.test(t)) return { label: p.label, severity: p.severity };
    }
    return null;
}

function walk(dir) {
    let entries;
    try { entries = fs.readdirSync(dir); } catch (_) { return; }
    for (const e of entries) {
        if (SKIP_DIRS.has(e)) continue;
        const full = path.join(dir, e);
        let stat; try { stat = fs.statSync(full); } catch (_) { continue; }
        if (stat.isDirectory()) { walk(full); continue; }
        if (!/\.(js|ts)$/.test(e)) continue;
        if (SKIP_FILES.has(e)) continue;
        // Skip seed scripts and test scripts (not production runtime)
        const relPath = full.replace(/\\/g, '/');
        const isNonProd = /\/(scripts|test|spec|seed|chaos|load-test|verify|validate)/.test(relPath)
            || /\.(test|spec)\.js$/.test(e)
            || relPath.includes('prisma/seed');

        let src; try { src = fs.readFileSync(full, 'utf8'); } catch (_) { continue; }
        const lines = src.split('\n');
        lines.forEach((line, i) => {
            const match = classifyLine(line);
            if (match) {
                results.push({
                    file: relPath.replace(/.*\/111\//, ''),
                    line: i + 1,
                    severity: match.severity,
                    label: match.label,
                    isProd: !isNonProd,
                    snippet: line.trim().slice(0, 110)
                });
            }
        });
    }
}

walk('d:/111/backend');
walk('d:/111/frontend');

// Sort: prod first, then by severity
const ORDER = { HIGH: 0, MEDIUM: 1, LOW: 2 };
results.sort((a, b) => {
    if (a.isProd !== b.isProd) return b.isProd - a.isProd;
    return ORDER[a.severity] - ORDER[b.severity];
});

// Output classified
const prod = results.filter(r => r.isProd);
const nonprod = results.filter(r => !r.isProd);

console.log('\n=== PRODUCTION RUNTIME CREDENTIAL LOG RISKS ===');
console.log(`Total production-file hits: ${prod.length}`);
prod.forEach(r => {
    console.log(`[${r.severity}] ${r.severity === 'HIGH' ? 'REMOVE' : 'REVIEW'} | ${r.file}:${r.line} | ${r.label}`);
    console.log(`   ${r.snippet}`);
});

console.log('\n=== NON-PRODUCTION (scripts/seed/test) ===');
console.log(`Total non-prod hits: ${nonprod.length}`);
nonprod.forEach(r => {
    console.log(`[${r.severity}] ${r.file}:${r.line} | ${r.label} | ${r.snippet.slice(0,80)}`);
});
