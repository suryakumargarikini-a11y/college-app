const fs = require('fs');
const src = fs.readFileSync('d:/111/frontend/app.js','utf8');

const checks = [
  ['qrcode-generator engine', 'qrcodeEngine'],
  ['QRCode constructor call', 'new QRConstructor(canvas'],
  ['token retrieval', 'getQrToken'],
  ['margin 4', 'margin: 4'],
  ['minPixels 10', 'minPixels: 10'],
  ['colorDark', 'colorDark:'],
  ['canvas display block', 'canvas.style.display'],
  ['canvas hidden remove', 'canvas.classList.remove'],
  ['errEl hide', 'errEl.classList.add'],
  ['fetchAndRender', 'fetchAndRender()'],
  ['timeoutWatchdog', 'timeoutWatchdog'],
  ['processingRef guard-scanner', 'processingRef'],
  ['verify-qr endpoint', 'verify-qr'],
  ['confirm-exit endpoint', 'confirm-exit'],
  ['handleScanSuccess', 'handleScanSuccess'],
  ['ALREADY_USED handling', 'ALREADY_USED'],
  ['ALREADY_EXITED handling', 'ALREADY_EXITED'],
];

let allPass = true;
checks.forEach(([label, needle]) => {
  const found = src.includes(needle);
  console.log((found ? 'PASS' : 'FAIL') + '  ' + label);
  if(!found) allPass = false;
});

console.log('');
console.log(allPass ? 'ALL PRODUCTION CHECKS PASS' : 'WARNING — missing production components');
