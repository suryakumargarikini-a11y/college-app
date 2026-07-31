const express = require('express');
const sessionManager = require('./services/sessionManager');
const dataProvider = require('./adapters/dataProvider');

async function testFullFlow() {
    console.log('====================================================');
    console.log('EMPIRICAL DIAGNOSTIC TEST: GET /api/student/results');
    console.log('====================================================');

    const userId = '23B61A0449';
    console.log('\n[STEP 1] Generating session token for student:', userId);
    const token = sessionManager.createSession(userId, 'pass123', 'mock_cookies', { studentName: 'M. SURYA KUMAR' }, 'STUDENT', false);
    console.log('Generated token:', token);

    console.log('\n[STEP 2] Fetching marks data directly from dataProvider for:', userId);
    const results = await dataProvider.getMarks(userId);

    console.log('\n[STEP 3] Raw JSON payload returned by backend provider:');
    console.log(JSON.stringify(results, null, 2));

    console.log('\n[STEP 4] Verifying semester array length:');
    console.log('results.semesters.length ==', results.semesters ? results.semesters.length : 0);

    if (results.semesters && results.semesters.length === 6) {
        console.log('✓ SUCCESS: All 6 completed semesters are present in backend payload!');
    } else {
        console.error('✗ FAILURE: Semester count mismatch!');
    }

    console.log('\n[STEP 5 & 6] Simulating frontend renderAcademicHistory() parsing:');
    results.semesters.forEach((sem, idx) => {
        console.log(`Card #${idx + 1}: Title="${sem.semesterName}" | SGPA=${sem.sgpa} | Earned Credits=${sem.creditsEarned}/${sem.totalCredits}`);
    });

    console.log('\n[STEP 9] Overall Academic Summary:');
    console.log('CGPA:', results.overall.cgpa);
    console.log('Percentage:', results.overall.percentage);
    console.log('Total Credits:', results.overall.totalCredits);
}

testFullFlow().catch(console.error);
