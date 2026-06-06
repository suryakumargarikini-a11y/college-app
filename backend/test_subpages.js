const puppeteer = require('puppeteer');
const fs = require('fs');

async function main() {
  console.log('Launching browser...');
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();

  // Print all page errors and console messages
  page.on('console', msg => {
    console.log(`[BROWSER CONSOLE] ${msg.type().toUpperCase()}: ${msg.text()}`);
  });
  page.on('pageerror', err => {
    console.error(`[BROWSER EXCEPTION] ${err.toString()}`);
  });
  page.on('requestfailed', request => {
    console.log(`[BROWSER NET ERROR] ${request.failure().errorText} at ${request.url()}`);
  });

  console.log('Navigating to login page...');
  await page.goto('http://localhost:3000/#/login', { waitUntil: 'networkidle2' });

  console.log('Filling out credentials...');
  await page.waitForSelector('#userId');
  await page.type('#userId', '25B61A0596');
  await page.type('#password', 'webcap');

  console.log('Submitting login form...');
  await Promise.all([
    page.click('button[type="submit"]'),
    page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 10000 }).catch(() => {})
  ]);

  console.log('Waiting 3 seconds on dashboard...');
  await new Promise(r => setTimeout(r, 3000));

  console.log('--- Navigating to /attendance ---');
  await page.evaluate(() => window.location.hash = '/attendance');
  await new Promise(r => setTimeout(r, 4000));

  console.log('Current URL (Attendance):', page.url());
  const attendanceHtml = await page.evaluate(() => document.body.innerHTML);
  fs.writeFileSync('d:\\111\\backend\\attendance_render.html', attendanceHtml);
  await page.screenshot({ path: 'C:\\Users\\singl\\.gemini\\antigravity\\brain\\37668678-e3d9-4724-a2ad-5f803a0199ad\\media__attendance.png' });

  console.log('--- Navigating to /fees ---');
  await page.evaluate(() => window.location.hash = '/fees');
  await new Promise(r => setTimeout(r, 4000));

  console.log('Current URL (Fees):', page.url());
  const feesHtml = await page.evaluate(() => document.body.innerHTML);
  fs.writeFileSync('d:\\111\\backend\\fees_render.html', feesHtml);
  await page.screenshot({ path: 'C:\\Users\\singl\\.gemini\\antigravity\\brain\\37668678-e3d9-4724-a2ad-5f803a0199ad\\media__fees.png' });

  await browser.close();
  console.log('Done!');
}

main().catch(e => console.error('FAIL:', e.stack));
