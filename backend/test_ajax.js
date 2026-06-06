// Test calling AjaxPro endpoints directly
const axios = require('axios');
const cheerio = require('cheerio');

async function test() {
    // First, login via Puppeteer to get cookies
    const puppeteer = require('puppeteer');
    const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
    const page = await browser.newPage();
    await page.goto('https://sitamecap.co.in/SATYA/Default.aspx', { waitUntil: 'networkidle2', timeout: 30000 });
    await page.waitForSelector('#txtId2');
    await page.click('#txtId2');
    await page.type('#txtId2', '25B61A0596', { delay: 30 });
    await page.click('#txtPwd2');
    await page.type('#txtPwd2', 'webcap', { delay: 30 });
    await page.evaluate(() => document.getElementById('txtPwd2').blur());
    await new Promise(r => setTimeout(r, 500));
    await Promise.all([page.click('#imgBtn2'), page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 20000 })]).catch(() => {});
    
    const cookies = await page.cookies();
    const cookieStr = cookies.map(c => c.name + '=' + c.value).join('; ');
    console.log('Logged in. Cookies:', cookies.map(c => c.name).join(', '));

    // Get the master page to find AJAX assembly names
    const masterHtml = await page.content();
    
    // Extract assembly names from script src
    const profileAsmMatch = masterHtml.match(/ajax\/StudentProfile,([^.]+)\.ashx/);
    const masterAsmMatch = masterHtml.match(/ajax\/StudentMaster,([^.]+)\.ashx/);
    console.log('Profile assembly:', profileAsmMatch ? profileAsmMatch[1] : 'NOT FOUND');
    console.log('Master assembly:', masterAsmMatch ? masterAsmMatch[1] : 'NOT FOUND');

    // Navigate to profile page to get its assembly name
    await page.goto('https://sitamecap.co.in/SATYA/Academics/StudentProfile.aspx', { waitUntil: 'networkidle2', timeout: 20000 });
    const profilePageHtml = await page.content();
    const profileAsmMatch2 = profilePageHtml.match(/ajax\/StudentProfile,([^.]+)\.ashx/);
    console.log('Profile assembly from profile page:', profileAsmMatch2 ? profileAsmMatch2[1] : 'NOT FOUND');

    // Navigate to marks page to get its assembly name
    await page.goto('https://sitamecap.co.in/SATYA/Academics/StudentMarksReport.aspx', { waitUntil: 'networkidle2', timeout: 20000 });
    const marksPageHtml = await page.content();
    const marksAsmMatch = marksPageHtml.match(/ajax\/Academics_StudentMarksReport,([^.]+)\.ashx/);
    console.log('Marks assembly:', marksAsmMatch ? marksAsmMatch[1] : 'NOT FOUND');

    await browser.close();

    // Now test calling AjaxPro directly
    const profileAsm = profileAsmMatch2 ? profileAsmMatch2[1] : 'App_Web_h20gkxqi';
    const marksAsm = marksAsmMatch ? marksAsmMatch[1] : 'App_Web_h20gkxqi';

    console.log('\n=== Testing AjaxPro Profile Call ===');
    try {
        const profileResp = await axios.post(
            `https://sitamecap.co.in/SATYA/ajax/StudentProfile,${profileAsm}.ashx`,
            '["25B61A0596",false]',
            {
                headers: {
                    'Cookie': cookieStr,
                    'Content-Type': 'text/plain; charset=utf-8',
                    'X-AjaxPro-Method': 'ShowStudentProfileNew',
                    'User-Agent': 'Mozilla/5.0',
                    'Referer': 'https://sitamecap.co.in/SATYA/Academics/StudentProfile.aspx'
                },
                timeout: 20000
            }
        );
        const data = typeof profileResp.data === 'string' ? JSON.parse(profileResp.data.replace(/^\/\*.*?\*\//, '')) : profileResp.data;
        console.log('Profile response type:', typeof data);
        console.log('Has value:', !!data.value);
        if (data.value) {
            console.log('Value length:', data.value.length);
            // Parse the HTML value
            const $ = cheerio.load(data.value);
            console.log('Profile HTML preview:', data.value.substring(0, 500));
        }
    } catch (e) {
        console.log('Profile AJAX error:', e.message);
    }

    console.log('\n=== Testing AjaxPro Marks Call ===');
    try {
        const marksResp = await axios.post(
            `https://sitamecap.co.in/SATYA/ajax/Academics_StudentMarksReport,${marksAsm}.ashx`,
            '[]',
            {
                headers: {
                    'Cookie': cookieStr,
                    'Content-Type': 'text/plain; charset=utf-8',
                    'X-AjaxPro-Method': 'ShowMarks',
                    'User-Agent': 'Mozilla/5.0',
                    'Referer': 'https://sitamecap.co.in/SATYA/Academics/StudentMarksReport.aspx'
                },
                timeout: 20000
            }
        );
        const data = typeof marksResp.data === 'string' ? JSON.parse(marksResp.data.replace(/^\/\*.*?\*\//, '')) : marksResp.data;
        console.log('Marks response type:', typeof data);
        console.log('Has value:', !!data.value);
        if (data.value) {
            console.log('Value length:', data.value.length);
            console.log('Marks HTML preview:', data.value.substring(0, 500));
        }
    } catch (e) {
        console.log('Marks AJAX error:', e.message);
    }
}

test().catch(e => console.error('FATAL:', e.message));
