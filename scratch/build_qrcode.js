// build_qrcode.js — assembles the new qrcode.min.js by embedding qrcode-generator core
'use strict';
const fs = require('fs');

// Read the qrcode-generator source and strip its UMD export wrapper.
// The file structure is:
//   var qrcode = function() { ... }();    ← lines 18-2287, the self-contained engine
//   (function(factory){ ... }(...));      ← lines 2289-2297, UMD export — we drop this
const genSrc = fs.readFileSync(
  'd:/111/scratch/node_modules/qrcode-generator/dist/qrcode.js',
  'utf8'
);

// Drop everything from the UMD export block onward (line 2289+)
const umdStart = genSrc.indexOf('\n(function (factory) {');
const engineCore = genSrc.slice(0, umdStart).trimEnd();
// engineCore ends with: }());   ← the closing of the outer IIFE, produces window.qrcode

// Indent the embedded engine for clarity
const indented = engineCore.split('\n').map(l => '  ' + l).join('\n');

const output = `/**
 * qrcode.min.js — SITAM Smart ERP QR Generator
 *
 * Core engine: qrcode-generator v2.0.4 by Kazuhiko Arase
 * Copyright (c) 2009 Kazuhiko Arase, MIT License
 * https://github.com/kazuhikoarase/qrcode-generator
 *
 * Wrapper exposes: new QRCode(canvasElement, { text, margin, minPixels, colorDark, colorLight })
 * Canvas intrinsic size = (moduleCount + 2*margin) * minPixels — always an integer.
 * For a 64-char hex token (QR v4 ECL-L, 33 modules): (33+8)*10 = 410 px.
 */
(function (root, factory) {
  'use strict';
  /* Export: browser-global only. Node path intentionally omitted so the
     inner qrcode-generator engine's own module.exports check doesn't
     interfere with the outer wrapper's UMD resolution. */
  if (typeof root !== 'undefined') {
    root.QRCode = factory(root);
  }
}(typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : this),
function (root) {
  'use strict';

  // ── Embedded qrcode-generator engine (Kazuhiko Arase) ──────────────────────
  // Runs in an isolated scope; exposes var qrcodeEngine via closure capture.
  var qrcodeEngine = (function () {
    // Shadow module/exports so the engine's own UMD block (already stripped)
    // doesn't accidentally leak to outer scope. Pure defensive measure.
    var module = undefined;  // eslint-disable-line no-unused-vars
    var exports = undefined; // eslint-disable-line no-unused-vars

${indented}

    // 'qrcode' is now defined in this scope by the engine IIFE above.
    return qrcode; // eslint-disable-line no-undef
  }());

  // ── Public constructor ──────────────────────────────────────────────────────
  function QRCode(element, options) {
    var opts = (typeof options === 'string') ? { text: options } : (options || {});

    var text       = opts.text || opts.value || '';
    var margin     = (opts.margin    !== undefined) ? opts.margin    : 4;
    var minPixels  = (opts.minPixels !== undefined) ? opts.minPixels : 10;
    var colorDark  = opts.colorDark  || '#000000';
    var colorLight = opts.colorLight || '#ffffff';

    // Resolve canvas element
    var canvas;
    if (element && element.tagName && element.tagName.toLowerCase() === 'canvas') {
      canvas = element;
    } else if (typeof element === 'string' && typeof document !== 'undefined') {
      canvas = document.getElementById(element);
    } else if (element && typeof element.querySelector === 'function') {
      canvas = element.querySelector('canvas');
      if (!canvas && typeof document !== 'undefined') {
        canvas = document.createElement('canvas');
        element.appendChild(canvas);
      }
    }
    if (!canvas || typeof canvas.getContext !== 'function') return;

    // Build QR matrix — ECL 'L' (lowest error correction = maximum data capacity)
    var qr = qrcodeEngine(0, 'L');  // 0 = auto-select minimum QR version
    qr.addData(text, 'Byte');       // always Byte mode for binary-safe encoding
    qr.make();

    var mc   = qr.getModuleCount();         // e.g. 33 for a 64-char payload at v4/L
    var ppm  = Math.max(1, minPixels | 0); // pixels per module — must be integer
    var size = (mc + margin * 2) * ppm;    // total canvas edge in px (always integer)

    // Diagnostic — token value is NEVER logged
    console.log('[QR-GEN] moduleCount=' + mc +
                ' marginModules=' + margin +
                ' pixelsPerModule=' + ppm +
                ' canvasWidth='  + size +
                ' canvasHeight=' + size +
                ' tokenLength='  + text.length +
                ' tokenType='    + (/^[0-9a-f]{64}$/.test(text) ? 'hex64' : 'other'));

    // Set intrinsic canvas resolution — no CSS constraints applied here
    canvas.width  = size;
    canvas.height = size;

    // Disable sub-pixel interpolation on all engines
    canvas.style.imageRendering = 'pixelated';
    canvas.style.imageRendering = '-moz-crisp-edges';
    canvas.style.imageRendering = 'crisp-edges';

    var ctx = canvas.getContext('2d');

    // Background
    ctx.fillStyle = colorLight;
    ctx.fillRect(0, 0, size, size);

    // Modules — each is exactly ppm×ppm pixels at exact integer coordinates
    ctx.fillStyle = colorDark;
    for (var row = 0; row < mc; row++) {
      for (var col = 0; col < mc; col++) {
        if (qr.isDark(row, col)) {
          ctx.fillRect(
            (col + margin) * ppm,   // x — integer
            (row + margin) * ppm,   // y — integer
            ppm,                    // w — integer
            ppm                     // h — integer
          );
        }
      }
    }
  }

  // Keep backward-compat with any code that reads QRCode.CorrectLevel
  QRCode.CorrectLevel = { L: 1, M: 0, Q: 3, H: 2 };

  return QRCode;
}));
`;

fs.writeFileSync('d:/111/frontend/qrcode.min.js', output, 'utf8');
console.log('Written qrcode.min.js —', output.length, 'bytes');
