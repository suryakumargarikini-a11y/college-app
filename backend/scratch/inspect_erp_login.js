const axios = require('axios');
const cheerio = require('cheerio');

async function main() {
    console.log('Fetching ERP login page...');
    const res = await axios.get('https://sitamecap.co.in/SATYA/Default.aspx', { 
        timeout: 15000,
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    });
    const $ = cheerio.load(res.data);
    
    // Find all form inputs
    console.log('\n=== ALL FORM INPUTS ===');
    $('input').each((i, el) => {
        const name = $(el).attr('name') || '(no name)';
        const id = $(el).attr('id') || '(no id)';
        const type = $(el).attr('type') || 'text';
        const value = $(el).attr('value') || '';
        console.log(`[${type}] name='${name}' id='${id}' value='${value.substring(0,40)}'`);
    });
    
    console.log('\n=== ALL FORMS ===');
    $('form').each((i, el) => {
        console.log(`Form action: '${$(el).attr('action')}', method: '${$(el).attr('method')}'`);
    });
    
    console.log('\n=== ALL BUTTONS/SUBMIT ELEMENTS ===');
    $('input[type=submit], input[type=image], button').each((i, el) => {
        const name = $(el).attr('name') || '(no name)';
        const id = $(el).attr('id') || '(no id)';
        const val = $(el).attr('value') || $(el).text() || '';
        console.log(`Submit: name='${name}' id='${id}' val='${val}'`);
    });
    
    console.log('\nViewState length:', $('#__VIEWSTATE').val()?.length);
    console.log('EventValidation length:', $('#__EVENTVALIDATION').val()?.length);
    console.log('ViewStateGenerator value:', $('#__VIEWSTATEGENERATOR').val());
    
    // Also check what the "debug_online_payment.html" saved previously
    console.log('\nDone.');
}
main().catch(e => console.error('Error:', e.message));
