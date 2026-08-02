/**
 * Academic Module V2 - Standalone Dynamic ERP HTML Parser
 * 
 * Parses SITAM ECAP ERP marks report HTML into structured AcademicHistoryDTO.
 */

const cheerio = require('cheerio');
const logger = require('../../services/logger');

class AcademicParser {
    /**
     * Parse raw SITAM ECAP ERP marks HTML.
     * @param {string} html 
     * @returns {import('./academic.types').AcademicHistoryDTO}
     */
    parse(html) {
        const results = {
            overall: {
                cgpa: '--',
                sgpa: '--',
                percentage: '--',
                totalCredits: '--',
                registeredCredits: '--',
                status: 'PASS'
            },
            semesters: []
        };

        if (!html || typeof html !== 'string' || html.trim().length === 0) {
            logger.warn('[AcademicParser] Empty HTML string provided');
            return results;
        }

        try {
            const $ = cheerio.load(html);
            const cleanText = html.replace(/&nbsp;/gi, ' ');

            // 1. Extract Overall Summary Metrics (CGPA, Credits, Percentage)
            const overallMatch = cleanText.match(/CGPA:\s*([\d.]+)\s*Credits:\s*([\d.\/]+)\s*([\d.]+)\s*%/i);
            if (overallMatch) {
                results.overall.cgpa = parseFloat(overallMatch[1]).toFixed(2);
                const creditParts = overallMatch[2].split('/');
                results.overall.totalCredits = creditParts[0] || '--';
                results.overall.registeredCredits = creditParts[1] || creditParts[0] || '--';
                results.overall.percentage = parseFloat(overallMatch[3]).toFixed(2) + '%';
            } else {
                const cgpaMatch = html.match(/CGPA:[\s\S]*?([\d.]+)/i);
                if (cgpaMatch) {
                    results.overall.cgpa = parseFloat(cgpaMatch[1]).toFixed(2);
                }
                const pctMatch = html.match(/([\d.]+)\s*%/i);
                if (pctMatch) {
                    results.overall.percentage = parseFloat(pctMatch[1]).toFixed(2) + '%';
                }
            }

            let semCounter = 0;

            // 2. Iterate through all tables to find Grade & Results tables
            $('table').each((tableIndex, table) => {
                const rows = $(table).find('tr');
                if (rows.length < 2) return;

                const headerTds = $(rows[0]).find('td');
                const headers = [];
                headerTds.each((j, td) => headers.push($(td).text().trim()));

                const row1Tds = $(rows[1]).find('td');
                const firstCell = row1Tds.first().text().trim();
                const firstBold = $(row1Tds.first()).find('b').text().trim();

                if (firstCell === 'Grade' || firstBold === 'Grade') {
                    semCounter++;

                    // Extract preceding heading (e.g., "I/IV B.Tech I Semester")
                    let semName = `Semester ${semCounter}`;
                    const prevHeadings = $(table).prevAll('span.reportHeading2, div.reportHeading2, span, font').toArray();
                    for (const elem of prevHeadings) {
                        const txt = $(elem).text().trim();
                        if (txt && (txt.includes('Semester') || txt.includes('B.Tech') || txt.includes('I/IV') || txt.includes('II/IV') || txt.includes('III/IV') || txt.includes('IV/IV'))) {
                            if (!txt.includes('EXTERNAL MARKS') && !txt.includes('PREVIOUS SEMESTERS')) {
                                semName = txt;
                                break;
                            }
                        }
                    }

                    const semSubjects = [];
                    let semSgpa = '--';
                    let semEarnedCredits = '--';
                    let semTotalCredits = '--';

                    for (let colIndex = 1; colIndex < headers.length; colIndex++) {
                        const rawCode = headers[colIndex];
                        const subjectCode = this.normalizeSubjectCode(rawCode);
                        const grade = $(row1Tds[colIndex]).text().trim().toUpperCase();

                        if (subjectCode === 'SGPA') {
                            semSgpa = grade;
                            if (semCounter === 1 || results.overall.sgpa === '--') {
                                results.overall.sgpa = semSgpa;
                            }
                            continue;
                        }

                        if (!subjectCode || subjectCode === '\u00a0' || subjectCode === 'TOTAL') continue;

                        let credits = '3.0';
                        if (rows.length >= 3) {
                            const creditTds = $(rows[2]).find('td');
                            if (colIndex < creditTds.length) {
                                const credTxt = $(creditTds[colIndex]).text().trim();
                                if (credTxt.includes('/')) {
                                    const parts = credTxt.split('/');
                                    credits = parts[0] || '3.0';
                                    semEarnedCredits = parts[0];
                                    semTotalCredits = parts[1];
                                } else {
                                    credits = credTxt || '3.0';
                                }
                            }
                        }

                        const isLab = subjectCode.includes('LAB') || subjectCode.includes('PRACTICAL') || subjectCode.includes('WORKSHOP');
                        const isPass = !(grade === 'F' || grade === 'ABSENT' || grade === 'FAIL' || grade === 'AB');

                        semSubjects.push({
                            code: subjectCode,
                            name: subjectCode,
                            grade,
                            credits,
                            type: isLab ? 'Lab' : 'Core',
                            result: isPass ? 'PASS' : 'FAIL'
                        });
                    }

                    if (rows.length >= 3) {
                        const creditTds = $(rows[2]).find('td');
                        const lastCreditTxt = creditTds.last().text().trim();
                        if (lastCreditTxt.includes('/')) {
                            const parts = lastCreditTxt.split('/');
                            semEarnedCredits = parts[0];
                            semTotalCredits = parts[1];
                        }
                    }

                    results.semesters.push({
                        semester: String(semCounter),
                        semesterName: semName,
                        sgpa: semSgpa,
                        creditsEarned: semEarnedCredits !== '--' ? semEarnedCredits : semSubjects.reduce((sum, s) => sum + (parseFloat(s.credits) || 0), 0).toFixed(1),
                        totalCredits: semTotalCredits !== '--' ? semTotalCredits : semSubjects.reduce((sum, s) => sum + (parseFloat(s.credits) || 0), 0).toFixed(1),
                        subjects: semSubjects
                    });
                }
            });

            // Set latest semester SGPA as overall SGPA if not captured
            if (results.overall.sgpa === '--' && results.semesters.length > 0) {
                results.overall.sgpa = results.semesters[results.semesters.length - 1].sgpa || '--';
            }

            logger.info(`[AcademicParser] Successfully parsed ${results.semesters.length} semesters. CGPA: ${results.overall.cgpa}`);
        } catch (err) {
            logger.error(`[AcademicParser] Failed to parse marks HTML: ${err.message}`, { stack: err.stack });
        }

        return results;
    }

    /**
     * Clean and normalize raw subject headers.
     * @param {string} rawHeader 
     * @returns {string}
     */
    normalizeSubjectCode(rawHeader) {
        if (!rawHeader) return '';
        let clean = rawHeader.replace(/<[^>]*>/g, '').trim().toUpperCase();
        clean = clean.replace(/^(SUBJECT|COURSE|CODE)\s*[:.-]?\s*/i, '');
        if (clean === 'S.NO' || clean === 'SL.NO' || clean === 'GRADE') return '';
        return clean;
    }
}

module.exports = new AcademicParser();
