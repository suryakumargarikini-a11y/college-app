/**
 * Deep Forensic Investigation Script for Student 23B61A0449
 */
const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

console.log('=== Deep Forensic Investigation for Student 23B61A0449 ===\n');

async function runInvestigation() {
    const rawFile = path.join(__dirname, 'debug_marks_23B61A0449_raw.html');
    let html = '';

    if (fs.existsSync(rawFile)) {
        console.log(`[1] Found existing raw file: ${rawFile}`);
        html = fs.readFileSync(rawFile, 'utf8');
    } else {
        console.log('[1] Live scraping ERP for student 23B61A0449...');
        const erpBrowserService = require('./services/erpBrowserService');
        const password = process.env.TEST_STUDENT_PASSWORD || '23B61A0449';
        
        try {
            const result = await erpBrowserService.login('23B61A0449', password, 'REQ-FORENSIC-23B61A0449');
            html = result.scrapedData.marksHtml || '';
            if (html) {
                fs.writeFileSync(rawFile, html, 'utf8');
                console.log(`✅ Saved raw HTML response to: ${rawFile} (${html.length} bytes)`);
            } else {
                console.error('❌ Scraper returned empty marksHtml');
                return;
            }
        } catch (e) {
            console.error('❌ Live login/scrape failed:', e.message);
            // Fallback check: check if any debug_marks file exists in root or backend
            const rootFiles = ['debug_marks_latest.html', 'debug_marks.html', 'debug_marks_real.html'];
            for (const rf of rootFiles) {
                const p = path.join(__dirname, rf);
                if (fs.existsSync(p)) {
                    console.log(`[Fallback] Using ${rf} for analysis`);
                    html = fs.readFileSync(p, 'utf8');
                    break;
                }
            }
        }
    }

    if (!html) {
        console.error('❌ No HTML content available for analysis');
        return;
    }

    console.log(`\n--- RAW HTML ANALYSIS (Total Length: ${html.length} bytes) ---`);

    // 1. Count occurrences of class="reportHeading2"
    const headingMatches = html.match(/class=["']reportHeading2["']/gi) || [];
    console.log(`2. Total occurrences of class="reportHeading2": ${headingMatches.length}`);

    // 2. Count total <table> tags
    const $ = cheerio.load(html);
    const tables = $('table');
    console.log(`3. Total <table> elements found by Cheerio: ${tables.length}`);

    // 3. Inspect every heading element & surrounding text
    console.log('\n4. ALL HEADINGS AND SURROUNDING TEXT IN HTML:');
    $('.reportHeading2, .reportHeading2WithBackground, font, span').each((idx, el) => {
        const txt = $(el).text().trim();
        if (txt.includes('Semester') || txt.includes('B.Tech') || txt.includes('MARKS') || txt.includes('CGPA') || txt.includes('Grade') || txt.includes('IV')) {
            console.log(`   [Heading #${idx + 1}] Tag: <${el.tagName}> Class: "${$(el).attr('class') || ''}" Text: "${txt}"`);
        }
    });

    // 4. Inspect every table found
    console.log('\n5. TABLE DETAILED AUDIT:');
    tables.each((tIdx, tbl) => {
        const rows = $(tbl).find('tr');
        if (rows.length === 0) return;
        const row0Text = $(rows[0]).text().trim().replace(/\s+/g, ' ').slice(0, 100);
        const row1Text = rows.length > 1 ? $(rows[1]).text().trim().replace(/\s+/g, ' ').slice(0, 100) : '';
        const prevText = $(tbl).prev().text().trim().slice(0, 80);
        const prevHeading = $(tbl).prevAll('.reportHeading2, span, font, div').first().text().trim();

        console.log(`\n   --- [TABLE #${tIdx + 1}] ---`);
        console.log(`   Rows Count: ${rows.length}`);
        console.log(`   Preceding Element Text: "${prevText}"`);
        console.log(`   Preceding Heading: "${prevHeading}"`);
        console.log(`   Row 0 (Header): "${row0Text}"`);
        console.log(`   Row 1 (Content): "${row1Text}"`);
    });

    // 5. Test parser against this raw HTML
    console.log('\n6. PARSER OUTPUT TEST:');
    const { ERPScraper } = require('./services/erpScraper');
    const parsed = ERPScraper.parseMarks({ marksHtml: html });

    console.log('   Semesters Parsed:', parsed.semesters.length);
    parsed.semesters.forEach(s => {
        console.log(`   - Semester ${s.semester} (${s.semesterName}): SGPA ${s.sgpa}, ${s.subjects.length} subjects`);
    });
    console.log('   Overall CGPA:', parsed.cgpa || parsed.overall.cgpa);
    console.log('   Overall Percentage:', parsed.percentage || parsed.overall.percentage);
}

runInvestigation();
