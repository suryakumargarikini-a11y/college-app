const fs = require('fs');
const path = require('path');

const skip = new Set(['node_modules','.git','android','scratch','zip_extract_temp','node']);
const found = [];

function walk(dir) {
  let entries;
  try { entries = fs.readdirSync(dir); } catch(e) { return; }
  for(const e of entries) {
    if(skip.has(e)) continue;
    const full = path.join(dir,e);
    let stat;
    try { stat = fs.statSync(full); } catch(e) { continue; }
    if(stat.isDirectory()) { walk(full); continue; }
    if(!/\.(js|ts|json|env|toml|yml|yaml|md|sh)$/.test(e) && !e.includes('.env')) continue;
    let src;
    try { src = fs.readFileSync(full,'utf8'); } catch(e) { continue; }

    const lines = src.split('\n');
    lines.forEach((line,i) => {
      const trimmed = line.trim();
      if(trimmed.startsWith('//') || trimmed.startsWith('#') || trimmed.startsWith('*')) return;
      if(full.includes('.example') || full.includes('.env.example')) return;

      // Default/weak JWT secret
      if(line.includes('sitam-admin-secret-key')) {
        found.push({ file: full.replace('d:\\111\\',''), line: i+1, label: 'DEFAULT_WEAK_ADMIN_JWT_SECRET' });
      }
      // Pattern: fallback secret in || 
      if(/\|\|\s*['"][a-zA-Z0-9\-_]{8,}['"]/.test(line) && /secret|key|password|token/i.test(line)) {
        found.push({ file: full.replace('d:\\111\\',''), line: i+1, label: 'FALLBACK_SECRET_IN_CODE', snippet: trimmed.slice(0,100) });
      }
      // Hardcoded db URL
      if(/postgresql:\/\/\w+:\w+@/.test(line) || /mongodb\+srv:\/\/\w+:\w+@/.test(line)) {
        found.push({ file: full.replace('d:\\111\\',''), line: i+1, label: 'HARDCODED_DB_URL' });
      }
      // Authorization header logged
      if(/console\.log.*[Aa]uthorization/.test(line) || /console\.log.*[Tt]oken/.test(line)) {
        found.push({ file: full.replace('d:\\111\\',''), line: i+1, label: 'TOKEN_LOGGED_TO_CONSOLE', snippet: trimmed.slice(0,100) });
      }
      // Bearer in source
      if(/['"]Bearer [a-zA-Z0-9\.\-_]{20,}['"]/.test(line)) {
        found.push({ file: full.replace('d:\\111\\',''), line: i+1, label: 'HARDCODED_BEARER_TOKEN' });
      }
      // Firebase private key
      if(line.includes('FIREBASE_PRIVATE_KEY') && line.includes('BEGIN')) {
        found.push({ file: full.replace('d:\\111\\',''), line: i+1, label: 'FIREBASE_PRIVATE_KEY_IN_FILE' });
      }
      // execSync on request path (DoS risk)
      if(line.includes('execSync') && !line.trim().startsWith('//')) {
        found.push({ file: full.replace('d:\\111\\',''), line: i+1, label: 'EXEC_SYNC_IN_SOURCE', snippet: trimmed.slice(0,100) });
      }
      // $queryRawUnsafe
      if(line.includes('queryRawUnsafe') || line.includes('executeRawUnsafe')) {
        found.push({ file: full.replace('d:\\111\\',''), line: i+1, label: 'RAW_UNSAFE_PRISMA', snippet: trimmed.slice(0,100) });
      }
      // trust proxy missing check
      if(line.includes('trust proxy') || line.includes('trustProxy')) {
        found.push({ file: full.replace('d:\\111\\',''), line: i+1, label: 'TRUST_PROXY_SETTING', snippet: trimmed.slice(0,100) });
      }
    });
  }
}
walk('d:\\111');
found.forEach(f => console.log(JSON.stringify(f)));
console.log('TOTAL:', found.length);
