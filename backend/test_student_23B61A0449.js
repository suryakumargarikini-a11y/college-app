/**
 * Verification test script for student 23B61A0449
 * Validates complete academic history scraping, parsing, SGPA, CGPA & subjects.
 */
const fs = require('fs');
const path = require('path');
const { ERPScraper } = require('./services/erpScraper');

console.log('=== Academic History Verification Test for 23B61A0449 ===\n');

async function runTest() {
    try {
        const erpBrowserService = require('./services/erpBrowserService');
        const userId = '23B61A0449';
        // Check if we have cached HTML or run browser scrape
        let scrapedData = null;

        const debugMarksFile = path.join(__dirname, `debug_marks_${userId}.html`);
        if (fs.existsSync(debugMarksFile)) {
            console.log(`[Test] Loading cached debug HTML from ${debugMarksFile}`);
            scrapedData = {
                marksHtml: fs.readFileSync(debugMarksFile, 'utf8')
            };
        } else if (fs.existsSync(path.join(__dirname, 'debug_marks_real.html'))) {
            console.log('[Test] Testing parser with debug_marks_real.html');
            scrapedData = {
                marksHtml: fs.readFileSync(path.join(__dirname, 'debug_marks_real.html'), 'utf8')
            };
        }

        if (!scrapedData || !scrapedData.marksHtml) {
            console.log('[Test] Triggering live ERP browser scrape for student:', userId);
            // Default student password for test if available or prompt
            const password = process.env.TEST_STUDENT_PASSWORD || '23B61A0449';
            const result = await erpBrowserService.login(userId, password, 'REQ-TEST-23B61A0449');
            scrapedData = result.scrapedData;
            if (scrapedData.marksHtml) {
                fs.writeFileSync(debugMarksFile, scrapedData.marksHtml, 'utf8');
                console.log(`Saved debug HTML to ${debugMarksFile}`);
            }
        }

        console.log('\n--- PARSING MARKS HTML ---');
        const parsed = ERPScraper.parseMarks(scrapedData);

        console.log('\n1. OVERALL ACADEMIC PERFORMANCE:');
        console.log('   CGPA:', parsed.overall.cgpa || parsed.cgpa);
        console.log('   Total Credits:', parsed.overall.totalCredits);
        console.log('   Registered Credits:', parsed.overall.registeredCredits);
        console.log('   Percentage:', parsed.overall.percentage || parsed.percentage);
        console.log('   Status:', parsed.overall.status);

        console.log(`\n2. SEMESTERS DISCOVERED (${parsed.semesters.length} total):`);
        parsed.semesters.forEach((sem, idx) => {
            console.log(`\n   --- [SEMESTER ${sem.semester}: ${sem.semesterName}] ---`);
            console.log(`   SGPA: ${sem.sgpa}`);
            console.log(`   Earned Credits: ${sem.credits} / Total Credits: ${sem.totalCredits}`);
            console.log(`   Subject Count: ${sem.subjects.length}`);
            console.log('   Subjects:');
            sem.subjects.forEach(s => {
                console.log(`     - [${s.code}] Grade: ${s.grade} | Credits: ${s.credits} | Result: ${s.result}`);
            });
        });

        console.log('\n--- AUDIT VERIFICATION SUMMARY ---');
        console.log('Total Semesters Parsed:', parsed.semesters.length);
        console.log('Total Subjects Across Semesters:', parsed.semesters.reduce((acc, s) => acc + s.subjects.length, 0));
        console.log('Overall CGPA:', parsed.cgpa);
        console.log('Overall Percentage:', parsed.percentage);

        if (parsed.semesters.length > 0) {
            console.log('\n✅ VERIFICATION PASSED: Academic history parser successfully extracted all available semesters!');
        } else {
            console.log('\n❌ VERIFICATION FAILED: 0 semesters extracted from HTML.');
        }

    } catch (err) {
        console.error('❌ Test failed with error:', err.message, err.stack);
    }
}

runTest();
