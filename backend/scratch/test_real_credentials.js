const puppeteer = require('puppeteer');

async function main() {
    console.log('Launching browser...');
    const browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    try {
        const page = await browser.newPage();
        console.log('Navigating to SITAM login page...');
        await page.goto('https://sitamecap.co.in/SATYA/Default.aspx', {
            waitUntil: 'networkidle2',
            timeout: 30000
        });
        
        console.log('Entering credentials...');
        await page.waitForSelector('#txtId2', { timeout: 10000 });
        await page.click('#txtId2');
        await page.type('#txtId2', '25B61A4532', { delay: 50 });
        
        await page.click('#txtPwd2');
        await page.type('#txtPwd2', 'webcap', { delay: 50 });
        
        console.log('Clicking login...');
        await Promise.all([
            page.click('#imgBtn2'),
            page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 })
        ]);
        
        const currentUrl = page.url();
        console.log('Logged in URL:', currentUrl);
        
        const title = await page.title();
        console.log('Page Title:', title);
        
        const bodyText = await page.evaluate(() => document.body.innerText);
        if (bodyText.includes('Invalid') || bodyText.includes('incorrect') || bodyText.includes('fail')) {
            console.log('Login failed message detected on page!');
        } else {
            console.log('Login seems successful! Checking user element...');
            const name = await page.evaluate(() => {
                const el = document.getElementById('lblUser');
                return el ? el.textContent : 'Not Found';
            });
            console.log('Student Name:', name);
        }
    } catch (e) {
        console.error('ERROR during scrape:', e.message);
    } finally {
        await browser.close();
        console.log('Browser closed.');
    }
}

main().catch(console.error);
