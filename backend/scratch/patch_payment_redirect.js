// Patch: rewrite paymentRedirect to use iframe login + direct payment page navigation
const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'controllers', 'dataControllers.js');
const content  = fs.readFileSync(filePath, 'utf8');

const startMarker = '\nconst paymentRedirect = async (req, res, next) => {';
const startIdx = content.indexOf(startMarker);
if (startIdx === -1) { console.error('ERROR: Cannot find paymentRedirect'); process.exit(1); }

const exportMarker = '\nmodule.exports = {';
const exportIdx = content.indexOf(exportMarker, startIdx);
if (exportIdx === -1) { console.error('ERROR: Cannot find module.exports'); process.exit(1); }

const before = content.substring(0, startIdx);
const after  = content.substring(exportIdx);

// NOTE: Template literals inside template literals need careful escaping.
// We build the HTML as a regular string and embed it via res.send().
const newFn = `
const paymentRedirect = async (req, res, next) => {
    try {
        const token = req.query.token;
        if (!token) return res.status(400).send('Missing session token');

        const sessionManager = require('../services/sessionManager');
        const session = sessionManager.getSession(token);
        if (!session) return res.status(401).send('Session expired or invalid. Please re-login inside the app.');

        const { userId, password } = session;
        const axios   = require('axios');
        const cheerio = require('cheerio');
        const crypto  = require('crypto');

        // AES-128-CBC — matches the ECAP client-side encryption
        const encryptAES = (text) => {
            const key    = Buffer.from('8701661282118308', 'utf8');
            const iv     = Buffer.from('8701661282118308', 'utf8');
            const cipher = crypto.createCipheriv('aes-128-cbc', key, iv);
            return cipher.update(text, 'utf8', 'base64') + cipher.final('base64');
        };

        const baseUrl           = (process.env.ERP_BASE_URL || 'https://sitamecap.co.in/SATYA').replace(/\\/$/, '');
        const encryptedPassword = encryptAES(password);
        const paymentPageUrl    = baseUrl + '/FeePayments/onlinepayment.aspx';

        logger.info('[PaymentRedirect] Fetching fresh ERP tokens for student: ' + userId);

        let viewState = '', eventValidation = '', viewStateGenerator = '';
        let erpReachable = false;

        try {
            const erpResp = await axios.get(baseUrl + '/Default.aspx', {
                timeout: 10000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                }
            });
            const $ = cheerio.load(erpResp.data);
            viewState          = ($('#__VIEWSTATE').val()          || '').replace(/"/g, '&quot;');
            eventValidation    = ($('#__EVENTVALIDATION').val()    || '').replace(/"/g, '&quot;');
            viewStateGenerator = ($('#__VIEWSTATEGENERATOR').val() || '').replace(/"/g, '&quot;');
            erpReachable       = viewState.length > 0;
            logger.info('[PaymentRedirect] ERP reachable. ViewState len=' + viewState.length);
        } catch (fetchErr) {
            logger.warn('[PaymentRedirect] ERP unreachable: ' + fetchErr.message);
        }

        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');

        if (!erpReachable) {
            // Fallback: send to ERP login page directly
            return res.send(
                '<!DOCTYPE html><html><head>' +
                '<title>SITAM Payment Gateway</title>' +
                '<meta name="viewport" content="width=device-width, initial-scale=1.0">' +
                '<meta http-equiv="refresh" content="1;url=' + baseUrl + '/Default.aspx">' +
                '<style>body{margin:0;background:#0f172a;color:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;text-align:center}' +
                '.w{max-width:360px;padding:24px}.ic{font-size:48px;margin-bottom:16px}' +
                'h2{color:#a855f7;font-size:18px}p{color:#94a3b8;font-size:13px;line-height:1.6}' +
                'a{display:inline-block;margin-top:16px;padding:12px 28px;background:#7c3aed;color:#fff;border-radius:999px;text-decoration:none;font-weight:700}</style></head>' +
                '<body><div class="w"><div class="ic">&#x1F512;</div>' +
                '<h2>Opening SITAM ECAP</h2>' +
                '<p>Your ID: <strong style="color:#fff">' + userId + '</strong><br>Opening the fee payment portal...</p>' +
                '<a href="' + baseUrl + '/Default.aspx">Open SITAM ECAP &rarr;</a></div>' +
                '<script>setTimeout(function(){window.location.href="' + baseUrl + '/Default.aspx";},1200);</script>' +
                '</body></html>'
            );
        }

        // ERP reachable — use hidden iframe login so cookies are set, then navigate to payment page
        logger.info('[PaymentRedirect] Rendering iframe auto-login → payment page for: ' + userId);

        const html =
            '<!DOCTYPE html>' +
            '<html>' +
            '<head>' +
            '  <title>SITAM Smart ERP &mdash; Payment Gateway</title>' +
            '  <meta name="viewport" content="width=device-width, initial-scale=1.0">' +
            '  <style>' +
            '    * { box-sizing: border-box; }' +
            '    body { margin: 0; padding: 0; background: linear-gradient(135deg,#0f172a,#1e1b4b); color: #f8fafc;' +
            '      font-family: -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;' +
            '      display: flex; align-items: center; justify-content: center; min-height: 100vh; text-align: center; }' +
            '    .card { max-width: 380px; width: 90%; background: rgba(255,255,255,0.05);' +
            '      border: 1px solid rgba(255,255,255,0.12); border-radius: 20px; padding: 36px 28px;' +
            '      backdrop-filter: blur(16px); }' +
            '    .logo { font-size: 48px; margin-bottom: 8px; }' +
            '    h2 { font-size: 20px; font-weight: 700; margin: 0 0 4px;' +
            '      background: linear-gradient(90deg,#a78bfa,#f472b6);' +
            '      -webkit-background-clip: text; -webkit-text-fill-color: transparent; }' +
            '    .uid { display:inline-block; background:rgba(167,139,250,0.15);' +
            '      border:1px solid rgba(167,139,250,0.3); border-radius:8px;' +
            '      padding:3px 12px; font-size:13px; color:#c4b5fd; font-family:monospace; margin:10px 0 20px; }' +
            '    p { color: #94a3b8; font-size: 14px; line-height: 1.6; margin: 0; }' +
            '    .spinner { width:44px; height:44px; border:3px solid rgba(167,139,250,0.2);' +
            '      border-top:3px solid #a78bfa; border-radius:50%;' +
            '      animation:spin 0.8s linear infinite; margin:20px auto 16px; }' +
            '    .status { font-size:12px; color:#64748b; margin-top:12px; }' +
            '    @keyframes spin { to { transform: rotate(360deg); } }' +
            '  </style>' +
            '</head>' +
            '<body>' +
            '  <div class="card">' +
            '    <div class="logo">&#x1F4B3;</div>' +
            '    <h2>Online Fee Payment</h2>' +
            '    <div class="uid">' + userId + '</div>' +
            '    <div class="spinner"></div>' +
            '    <p>Signing in and opening payment portal&hellip;</p>' +
            '    <div class="status" id="st">Step 1 of 2: Authenticating...</div>' +
            '  </div>' +
            '' +
            '  <!-- Hidden iframe receives the login POST response -->' +
            '  <iframe id="loginIframe" name="loginIframe" style="display:none;width:0;height:0;border:0;"></iframe>' +
            '' +
            '  <!-- Login form targets the hidden iframe -->' +
            '  <form id="loginForm" method="post" action="' + baseUrl + '/Default.aspx" target="loginIframe" style="display:none;">' +
            '    <input type="hidden" name="__VIEWSTATE"          value="' + viewState          + '">' +
            '    <input type="hidden" name="__EVENTVALIDATION"    value="' + eventValidation    + '">' +
            '    <input type="hidden" name="__VIEWSTATEGENERATOR" value="' + viewStateGenerator + '">' +
            '    <input type="hidden" name="txtId2"               value="' + userId             + '">' +
            '    <input type="hidden" name="txtPwd2"              value="' + encryptedPassword  + '">' +
            '    <input type="hidden" name="hdnpwd2"              value="' + encryptedPassword  + '">' +
            '    <input type="hidden" name="imgBtn2.x"            value="1">' +
            '    <input type="hidden" name="imgBtn2.y"            value="1">' +
            '  </form>' +
            '' +
            '  <script>' +
            '    var paymentUrl = "' + paymentPageUrl + '";' +
            '    var navigated  = false;' +
            '' +
            '    function goToPayment() {' +
            '      if (navigated) return;' +
            '      navigated = true;' +
            '      document.getElementById("st").textContent = "Step 2 of 2: Opening payment page...";' +
            '      window.location.href = paymentUrl;' +
            '    }' +
            '' +
            '    // Detect when iframe finishes loading (= login POST completed)' +
            '    document.getElementById("loginIframe").addEventListener("load", function() {' +
            '      document.getElementById("st").textContent = "Step 2 of 2: Login confirmed. Opening payment...";' +
            '      setTimeout(goToPayment, 400);' +
            '    });' +
            '' +
            '    // Fallback: navigate after 4s even if load event does not fire' +
            '    setTimeout(goToPayment, 4000);' +
            '' +
            '    // Submit immediately — viewstate is fresh from this request' +
            '    document.getElementById("loginForm").submit();' +
            '  </script>' +
            '</body>' +
            '</html>';

        return res.send(html);
    } catch (error) {
        logger.error('[PaymentRedirect] Error: ' + error.message);
        const baseUrl = (process.env.ERP_BASE_URL || 'https://sitamecap.co.in/SATYA').replace(/\\/$/, '');
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.status(500).send(
            '<!DOCTYPE html><html><head><title>Error</title>' +
            '<meta name="viewport" content="width=device-width,initial-scale=1">' +
            '<style>body{background:#0f172a;color:#f8fafc;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;text-align:center;margin:0}' +
            '.w{max-width:360px;padding:24px}h2{color:#f472b6}p{color:#94a3b8;font-size:14px}' +
            'a{color:#a78bfa;margin-top:16px;display:inline-block;padding:12px 24px;background:rgba(167,139,250,0.1);border-radius:999px;text-decoration:none}</style></head>' +
            '<body><div class="w"><h2>Connection Error</h2>' +
            '<p>Could not reach the SITAM payment portal. Please try again.</p>' +
            '<a href="' + baseUrl + '/Default.aspx">Open SITAM ECAP &rarr;</a></div></body></html>'
        );
    }
};
`;

const newContent = before + newFn + after;
fs.writeFileSync(filePath, newContent, 'utf8');
console.log('SUCCESS: paymentRedirect patched with iframe login + direct payment navigation.');
console.log('File length:', newContent.length, 'bytes');
