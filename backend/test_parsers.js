/**
 * Test script to validate that the ERP scraper correctly parses
 * the saved debug HTML files. Run: node test_parsers.js
 */
const fs = require('fs');
const path = require('path');
const { ERPScraper } = require('./services/erpScraper');

console.log('=== ERP Scraper Parser Tests ===\n');

// Build a mock scrapedData object from the debug HTML files
const scrapedData = {
    studentName: 'Test Student'
};

const debugFiles = {
    profileHtml: 'debug_profile_real.html',
    marksHtml: 'debug_marks_real.html',
    feesHtml: 'debug_fees_real.html',
    assignmentsHtml: 'debug_assignments_real.html'
};

for (const [key, filename] of Object.entries(debugFiles)) {
    const filePath = path.join(__dirname, filename);
    if (fs.existsSync(filePath)) {
        scrapedData[key] = fs.readFileSync(filePath, 'utf8');
        console.log(`✅ Loaded ${key} from ${filename} (${scrapedData[key].length} bytes)`);
    } else {
        scrapedData[key] = '';
        console.log(`⚠ ${filename} not found, ${key} will be empty`);
    }
}

console.log('\n--- Testing parseProfile ---');
try {
    const profile = ERPScraper.parseProfile(scrapedData);
    console.log('Name:', profile.name);
    console.log('Roll:', profile.roll);
    console.log('Branch:', profile.branch);
    console.log('Semester:', profile.semester);
    console.log('Year:', profile.year);
    console.log('CGPA:', profile.cgpa);
    console.log('Email:', profile.email);
    console.log('Phone:', profile.phone);
    console.log('Father:', profile.fatherName);
    const passed = profile.name && profile.roll && profile.branch;
    console.log(passed ? '✅ Profile PASSED' : '❌ Profile FAILED - missing key fields');
} catch (e) {
    console.log('❌ Profile CRASHED:', e.message);
}

console.log('\n--- Testing parseMarks ---');
try {
    const marks = ERPScraper.parseMarks(scrapedData);
    console.log('CGPA:', marks.cgpa);
    console.log('SGPA:', marks.sgpa);
    console.log('Percentage:', marks.percentage);
    console.log('Subjects:', marks.subjects.length);
    marks.subjects.forEach(s => console.log(`  ${s.name}: ${s.grade} (${s.credits} credits)`));
    console.log('Overall Attendance:', marks.overallAttendance);
    console.log('Attendance records:', marks.attendance.length);
    marks.attendance.slice(0, 3).forEach(a => console.log(`  ${a.name}: ${a.percentage}% (${a.attended}/${a.total})`));
    const passed = marks.cgpa !== '--' && marks.subjects.length > 0;
    console.log(passed ? '✅ Marks PASSED' : '❌ Marks FAILED - missing data');
} catch (e) {
    console.log('❌ Marks CRASHED:', e.message);
}

console.log('\n--- Testing parseAttendance ---');
try {
    const att = ERPScraper.parseAttendance(scrapedData);
    console.log('Overall:', att.overall);
    console.log('Subjects:', att.subjects.length);
    att.subjects.slice(0, 3).forEach(a => console.log(`  ${a.name}: ${a.percentage}% (${a.attended}/${a.total}) [${a.status}]`));
    const passed = att.overall !== '--' && att.subjects.length > 0;
    console.log(passed ? '✅ Attendance PASSED' : '❌ Attendance FAILED');
} catch (e) {
    console.log('❌ Attendance CRASHED:', e.message);
}

console.log('\n--- Testing parseFees ---');
try {
    const fees = ERPScraper.parseFees(scrapedData);
    console.log('Total:', fees.totalAmount);
    console.log('Paid:', fees.paidAmount);
    console.log('Due:', fees.dueAmount);
    console.log('totalDue (frontend alias):', fees.totalDue);
    console.log('Progress:', fees.paidProgress + '%');
    console.log('Transactions:', fees.transactions.length);
    fees.transactions.forEach(t => console.log(`  ${t.title}: ${t.amount} | paid=${t.paid} | due=${t.due} | ${t.status}`));
    const passed = fees.totalAmount !== '--' && fees.transactions.length > 0;
    console.log(passed ? '✅ Fees PASSED' : '❌ Fees FAILED');
} catch (e) {
    console.log('❌ Fees CRASHED:', e.message);
}

console.log('\n--- Testing parseAssignments ---');
try {
    const asn = ERPScraper.parseAssignments(scrapedData);
    console.log('Count:', asn.activeCount);
    console.log('List:', asn.list.length);
    asn.list.forEach(a => console.log(`  ${a.title} | ${a.subject} | ${a.status}`));
    console.log('✅ Assignments PASSED (may be 0 if student has none)');
} catch (e) {
    console.log('❌ Assignments CRASHED:', e.message);
}

console.log('\n=== All parser tests complete ===');
