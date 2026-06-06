const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

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

  console.log('Waiting 5 seconds on dashboard...');
  await new Promise(r => setTimeout(r, 5000));

  console.log('Current URL:', page.url());
  const bodyText = await page.evaluate(() => document.body.innerHTML);
  fs.writeFileSync('d:\\111\\backend\\dashboard_render.html', bodyText);
  console.log('Dashboard rendered HTML length:', bodyText.length);

  // Take screenshot and save it
  const screenshotPath = 'C:\\Users\\singl\\.gemini\\antigravity\\brain\\37668678-e3d9-4724-a2ad-5f803a0199ad\\media__test.png';
  await page.screenshot({ path: screenshotPath });
  console.log('Screenshot saved to:', screenshotPath);

  await browser.close();
  console.log('Test completed.');
}

main().catch(e => console.error('FAIL:', e.stack));
