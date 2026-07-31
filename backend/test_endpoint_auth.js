/**
 * Test authentication & dataControllers.getStudentResults
 */
const dataControllers = require('./controllers/dataControllers');
const { ERPScraper } = require('./services/erpScraper');
const cacheService = require('./services/cacheService');
const fs = require('fs');
const path = require('path');

async function testEndpoint() {
    console.log('=== Testing getStudentResults Controller with Token Auth ===\n');

    // 1. Populate cache with 23B61A0449 data
    const rawFile = path.join(__dirname, 'debug_marks_23B61A0449_raw.html');
    const html = fs.readFileSync(rawFile, 'utf8');
    const parsed = ERPScraper.parseMarks({ marksHtml: html });

    cacheService.set('academic_results', '23B61A0449', {
        semesters: parsed.semesters,
        overall: parsed.overall
    }, 24 * 60 * 60 * 1000);

    // Mock Express req & res for Bearer Token user
    const req = {
        user: { userId: '23B61A0449', role: 'STUDENT' },
        session: undefined
    };

    const res = {
        ok: (data, msg) => {
            console.log('✅ Controller Response Success:');
            console.log('   Message:', msg);
            console.log('   Semesters Count:', data.semesters ? data.semesters.length : 0);
            console.log('   Overall CGPA:', data.overall ? data.overall.cgpa : '--');
            if (data.semesters) {
                data.semesters.forEach(s => {
                    console.log(`   - Sem ${s.semester} (${s.semesterName}): SGPA ${s.sgpa}, ${s.subjects.length} subjects`);
                });
            }
        },
        fail: (msg, data, code) => {
            console.error(`❌ Controller Response Fail (${code}):`, msg);
        }
    };

    await dataControllers.getStudentResults(req, res, (err) => {
        if (err) console.error('❌ Controller Error:', err);
    });
}

testEndpoint();
