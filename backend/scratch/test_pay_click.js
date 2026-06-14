const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

let browser;
let page;

async function main() {
    console.log('Launching test browser...');
    browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });

    // Enable console log capture
    page.on('console', msg => console.log(`[Browser Console] ${msg.text()}`));
    page.on('pageerror', err => console.error(`[Browser Exception] ${err.toString()}`));

    console.log('Navigating to local ERP login page...');
    await page.goto('http://localhost:3000/#/login', { waitUntil: 'domcontentloaded' });

    console.log('Logging in with test student credentials...');
    await page.waitForSelector('#userId');
    await page.type('#userId', '25B61A0596');
    await page.type('#password', 'webcap');
    
    await Promise.all([
        page.click('button[type="submit"]'),
        page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {})
    ]);

    console.log('Waiting for dashboard...');
    await new Promise(r => setTimeout(r, 3000));

    console.log('Navigating to fees panel...');
    await page.evaluate(() => window.location.hash = '/fees');
    await new Promise(r => setTimeout(r, 3500));

    // Capture screenshot of the fees page before clicking Pay Now
    const feesScreenshotPath = path.join(__dirname, '..', 'fees_page.png');
    await page.screenshot({ path: feesScreenshotPath });
    console.log(`Fees page screenshot saved to: ${feesScreenshotPath}`);

    console.log('Setting up listener for new window/tab targets...');
    // We expect the click to open a new tab/window
    const newTargetPromise = new Promise(resolve => browser.once('targetcreated', resolve));

    console.log('Clicking the "Pay Now" button...');
    await page.waitForSelector('#pay-now-btn');
    await page.click('#pay-now-btn');

    console.log('Waiting for the new tab to be created...');
    const newTarget = await newTargetPromise;
    const newPage = await newTarget.page();

    if (newPage) {
        console.log('New tab URL:', newPage.url());
        
        // Wait 3 seconds for the redirection page to process
        await new Promise(r => setTimeout(r, 3000));
        
        console.log('Final URL of new tab:', newPage.url());
        
        // Take a screenshot of the new tab
        const paymentScreenshotPath = path.join(__dirname, '..', 'payment_page.png');
        await newPage.screenshot({ path: paymentScreenshotPath });
        console.log(`Payment page screenshot saved to: ${paymentScreenshotPath}`);
    } else {
        console.log('No page found in the new target. Checking URL...');
        console.log('Target URL:', newTarget.url());
    }

    await browser.close();
    console.log('Verification completed.');
}

main().catch(async e => {
    console.error('Test failed:', e);
    try {
        if (page) {
            const fs = require('fs');
            await page.screenshot({ path: path.join(__dirname, '..', 'error_screenshot.png') });
            console.log('Error screenshot saved.');
            const html = await page.content();
            console.log('Error page HTML length:', html.length);
            fs.writeFileSync(path.join(__dirname, '..', 'error_page.html'), html);
        }
    } catch(err) {
        console.error('Failed to save error details:', err);
    }
    try {
        if (browser) await browser.close();
    } catch(err) {}
    process.exit(1);
});
