const puppeteer = require('puppeteer');
const fs = require('fs');

async function main() {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  
  // Login
  await page.goto('https://sitamecap.co.in/SATYA/Default.aspx', { waitUntil: 'networkidle2', timeout: 30000 });
  await page.waitForSelector('#txtId2', { timeout: 10000 });
  await page.click('#txtId2');
  await page.type('#txtId2', '25B61A0596', { delay: 50 });
  await page.click('#txtPwd2');
  await page.type('#txtPwd2', 'webcap', { delay: 50 });
  await page.evaluate(() => document.getElementById('txtPwd2').blur());
  await new Promise(r => setTimeout(r, 500));
  await Promise.all([page.click('#imgBtn2'), page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 20000 })]).catch(() => {});
  
  console.log('Logged in at:', page.url());
  const cookies = await page.cookies();
  const cookieStr = cookies.map(c => c.name+'='+c.value).join('; ');
  
  // Name from master page
  const nameText = await page.evaluate(() => {
    const el = document.getElementById('lblUser');
    return el ? el.textContent : '';
  });
  console.log('Name from master:', nameText);
  
  // Navigate to ACTUAL profile page (inside iframe)
  await page.goto('https://sitamecap.co.in/SATYA/Academics/StudentProfile.aspx', { waitUntil: 'networkidle2', timeout: 20000 });
  const profileHtml = await page.content();
  fs.writeFileSync('debug_profile_real.html', profileHtml);
  console.log('Real profile saved, length:', profileHtml.length);
  
  // Navigate to marks page
  await page.goto('https://sitamecap.co.in/SATYA/Academics/StudentMarksReport.aspx', { waitUntil: 'networkidle2', timeout: 20000 });
  const marksHtml = await page.content();
  fs.writeFileSync('debug_marks_real.html', marksHtml);
  console.log('Real marks saved, length:', marksHtml.length);
  
  // Navigate to fee details
  await page.goto('https://sitamecap.co.in/SATYA/FeePayments/studentpayments.aspx', { waitUntil: 'networkidle2', timeout: 20000 });
  const feesHtml = await page.content();
  fs.writeFileSync('debug_fees_real.html', feesHtml);
  console.log('Real fees saved, length:', feesHtml.length);
  
  // Navigate to assignments report
  await page.goto('https://sitamecap.co.in/SATYA/Academics/StudentAssignmentsReport.aspx', { waitUntil: 'networkidle2', timeout: 20000 });
  const assnHtml = await page.content();
  fs.writeFileSync('debug_assignments_real.html', assnHtml);
  console.log('Real assignments saved, length:', assnHtml.length);
  
  await browser.close();
  console.log('Done!');
}

main().catch(e => console.error('FAIL:', e.message));
