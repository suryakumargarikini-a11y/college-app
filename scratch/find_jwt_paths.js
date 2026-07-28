const fs = require('fs');
const path = require('path');

const skip = new Set(['node_modules','.git','android','scratch','zip_extract_temp','node','dist']);
const hits = [];

function walk(dir) {
  let entries;
  try { entries = fs.readdirSync(dir); } catch(e) { return; }
  for(const e of entries) {
    if(skip.has(e)) continue;
    const full = path.join(dir,e);
    let stat; try { stat = fs.statSync(full); } catch(e) { continue; }
    if(stat.isDirectory()) { walk(full); continue; }
    if(!/\.js$/.test(e)) continue;
    let src; try { src = fs.readFileSync(full,'utf8'); } catch(e) { continue; }
    const lines = src.split('\n');
    lines.forEach((line,i) => {
      const t = line.trim();
      if(t.startsWith('//') || t.startsWith('*')) return;
      const isJwt = /ADMIN_JWT_SECRET|jwt\.sign|jwt\.verify|signToken|verifyToken|createHmac.*sha256|\.digest.*base64.*replace|sitam-admin-secret/.test(line);
      if(isJwt) {
        hits.push({ file: full.replace('d:\\111\\','').replace('d:/111/',''), line: i+1, src: t.slice(0,120) });
      }
    });
  }
}
walk('d:\\111\\backend');

// Also scan for credential-logging patterns (P0-5)
const credHits = [];
function walkCred(dir) {
  let entries; try { entries = fs.readdirSync(dir); } catch(e) { return; }
  for(const e of entries) {
    if(skip.has(e)) continue;
    const full = path.join(dir,e);
    let stat; try { stat = fs.statSync(full); } catch(e) { continue; }
    if(stat.isDirectory()) { walkCred(full); continue; }
    if(!/\.js$/.test(e)) continue;
    let src; try { src = fs.readFileSync(full,'utf8'); } catch(e) { continue; }
    const lines = src.split('\n');
    lines.forEach((line,i) => {
      const t = line.trim();
      if(t.startsWith('//') || t.startsWith('*')) return;
      // Must be a console.log/error/warn or logger call
      if(!/console\.(log|error|warn)|logger\.(info|warn|error|debug)/.test(line)) return;
      // Must contain sensitive data patterns
      const isSensitive = /\btoken\b|\bpassword\b|\bcookie\b|\bAuthorization\b|\bBearer\b|\bjwt\b|\bsecret\b|\bsalt\b|\bauth\b/i.test(line)
        && !/token present|token length|token type|token count|no token|token prefix|token hash|token created|token found|TOKEN_NOT_FOUND|fcm.*token|push.*token|device.*token/i.test(line);
      if(isSensitive) {
        credHits.push({ file: full.replace('d:\\111\\','').replace('d:/111/',''), line: i+1, src: t.slice(0,120) });
      }
    });
  }
}
walkCred('d:\\111\\backend');
walkCred('d:\\111\\frontend');

console.log('\n=== JWT SIGNING/VERIFICATION PATHS ===');
hits.forEach(h => console.log(h.file + ':' + h.line + '  ' + h.src));

console.log('\n=== CREDENTIAL LOGGING RISKS (P0-5) ===');
credHits.forEach(h => console.log(h.file + ':' + h.line + '  ' + h.src));

console.log('\nJWT PATHS TOTAL:', hits.length);
console.log('CRED LOG RISKS TOTAL:', credHits.length);
