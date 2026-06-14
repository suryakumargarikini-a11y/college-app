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

    // Configure view port
    await page.setViewport({ width: 1280, height: 800 });

    // Print all page errors and console messages
    page.on('console', msg => {
        console.log(`[BROWSER CONSOLE] ${msg.type().toUpperCase()}: ${msg.text()}`);
    });
    page.on('pageerror', err => {
        console.error(`[BROWSER EXCEPTION] ${err.toString()}`);
    });

    console.log('Navigating to login page...');
    await page.goto('http://localhost:3000/#/login', { waitUntil: 'networkidle2' });

    console.log('Filling out credentials...');
    await page.waitForSelector('#login-userid');
    await page.type('#login-userid', '25B61A0596');
    await page.type('#login-password', 'webcap');

    console.log('Submitting login form...');
    await Promise.all([
        page.click('#login-btn'),
        page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {})
    ]);

    console.log('Waiting for dashboard...');
    await new Promise(r => setTimeout(r, 3000));

    console.log('Navigating to Fees screen...');
    await page.evaluate(() => {
        window.location.hash = '/fees';
    });

    console.log('Waiting for Fees page to load...');
    await page.waitForSelector('#pay-now-btn', { timeout: 10000 });
    
    // Allow brief time for data fetching and animations
    await new Promise(r => setTimeout(r, 2000));

    // Take screenshot of Fees screen
    const feesScreenshotPath = 'C:\\Users\\singl\\.gemini\\antigravity\\brain\\37668678-e3d9-4724-a2ad-5f803a0199ad\\media__fees_screen.png';
    await page.screenshot({ path: feesScreenshotPath });
    console.log(`Saved fees screen screenshot to: ${feesScreenshotPath}`);

    console.log('Clicking "Pay Now" button...');
    
    // Set up promise to catch the new tab
    const newTargetPromise = new Promise(resolve => browser.once('targetcreated', target => resolve(target.page())));
    
    await page.click('#pay-now-btn');
    
    console.log('Waiting for new tab to open...');
    const redirectPage = await newTargetPromise;
    if (!redirectPage) {
        throw new Error('Failed to capture the redirect page target!');
    }

    console.log('New tab opened. Monitoring URL...');
    
    // Set viewport for redirect page
    await redirectPage.setViewport({ width: 1280, height: 800 });

    // Wait for the final redirected payment URL or a timeout
    console.log('Waiting for form submission and redirect to execute (6 seconds)...');
    await new Promise(r => setTimeout(r, 6000));

    const finalUrl = redirectPage.url();
    console.log(`Final Redirected Page URL: ${finalUrl}`);

    // Take screenshot of the redirected page
    const redirectScreenshotPath = 'C:\\Users\\singl\\.gemini\\antigravity\\brain\\37668678-e3d9-4724-a2ad-5f803a0199ad\\media__payment_redirected.png';
    await redirectPage.screenshot({ path: redirectScreenshotPath });
    console.log(`Saved redirect page screenshot to: ${redirectScreenshotPath}`);

    // Read the title and body of the redirect page to verify content
    const pageInfo = await redirectPage.evaluate(() => {
        return {
            title: document.title,
            bodyLength: document.body.innerHTML.length,
            url: window.location.href
        };
    });
    console.log('Redirect Page details:', pageInfo);

    await browser.close();
    console.log('E2E UI click verification completed.');
}

main().catch(e => {
    console.error('E2E Test failed:', e);
    process.exit(1);
});
