const cheerio = require('cheerio');
const logger = require('./logger');

class SessionExpiredError extends Error {
    constructor(message) {
        super(message);
        this.name = 'SessionExpiredError';
    }
}

class ERPScraper {
    // Normalize subject codes to be consistent: E.g., "CS 402", "CS402", "CS-402" -> "CS-402"
    normalizeSubjectCode(code) {
        if (!code) return '';
        let clean = code.trim().toUpperCase();
        // Insert hyphen if missing between letters and numbers, e.g. CS402 -> CS-402
        clean = clean.replace(/^([A-Z]{2,4})\s*(\d{3,4})/g, '$1-$2');
        return clean;
    }

    // Parse student profile safely
    parseProfile(scrapedData) {
        const profile = {
            name: scrapedData.studentName || 'Student',
            roll: '', program: '', branch: '', semester: '', gender: '', dob: '',
            email: '', phone: '', fatherName: '', motherName: '', fatherMobile: '',
            hostel: '', roomNo: '', admissionNo: '', cgpa: '--', year: '',
            percentage: '--', address: '', joiningDate: '', caste: '', nationality: '',
            religion: '', sscMarks: '', interMarks: '', scholarship: '', seatType: '',
            entranceType: '', entranceRank: '', aadhar: '', section: 'A'
        };

        if (!scrapedData.profileHtml) {
            logger.warn('[Scraper] parseProfile: No profileHtml available');
            return profile;
        }

        try {
            const $ = cheerio.load(scrapedData.profileHtml);
            const fields = {};
            // Also collect the ORIGINAL (un-lowercased) label so we can log exact ERP text
            const rawLabels = {};

            $('tr').each((i, tr) => {
                const tds = $(tr).find('td');
                for (let j = 0; j < tds.length - 2; j++) {
                    const rawLabel = $(tds[j]).text().trim();
                    const label    = rawLabel.toLowerCase();
                    const sep      = $(tds[j + 1]).text().trim();
                    if (sep === ':') {
                        const value = $(tds[j + 2]).text().trim();
                        if (label && value) {
                            // Normalize duplicate whitespace
                            fields[label]    = value.replace(/\s+/g, ' ');
                            rawLabels[label] = rawLabel;   // preserve original casing
                        }
                    }
                }
            });

            // ── EVIDENCE LOG ─────────────────────────────────────────────────
            // Log EVERY label exactly as it appears in the ERP HTML (original casing).
            // This lets us verify parser mappings against real ERP data.
            const labelTable = Object.keys(rawLabels)
                .map(k => `  "${rawLabels[k]}" → "${fields[k]}"`)
                .join('\n');
            logger.info(`[Scraper] Raw ERP profile labels (exact):\n${labelTable}`);
            console.log(`[Scraper] Raw ERP profile labels:\n${labelTable}`);

            // ── Field mappings — ordered most-likely to least-likely per SITAM ERP observation ──
            // Multiple label variants per field to handle ERP label drift across semesters / portal updates.

            profile.admissionNo = fields['admission.no']
                || fields['admission no']  || fields['admission number']
                || fields['adm.no']        || fields['adm no']  || '';

            profile.roll = fields['rollno']   || fields['roll no']
                || fields['roll number']      || fields['roll_no']
                || fields['roll.no']          || '';

            profile.name = fields['name']     || fields['student name']
                || fields['student_name']     || profile.name;

            profile.program = fields['course'] || fields['program']
                || fields['programme']         || fields['degree']
                || fields['course name']       || '';

            profile.branch = fields['branch']     || fields['department']
                || fields['dept']                 || fields['specialization']
                || fields['stream']               || '';

            // Semester: do NOT fall back to a hardcoded value — keep empty so the UI can
            // distinguish "not synced yet" from a real ERP semester string.
            profile.semester = fields['semester']          || fields['current semester']
                || fields['currentsemester']               || fields['sem']
                || fields['semester no']                   || fields['semester number']
                || fields['academic semester']             || '';

            profile.gender = fields['gender'] || fields['sex'] || '';

            profile.dob = fields['dob']           || fields['date of birth']
                || fields['birth date']            || fields['birthdate']
                || fields['d.o.b']                 || fields['d.o.b.']  || '';

            profile.email = fields['email']        || fields['e-mail']
                || fields['email id']              || fields['emailid']
                || fields['email address']         || fields['mail']  || '';

            profile.phone = fields['mobile.no']    || fields['mobile no']
                || fields['mobile no.']            || fields['mobile number']
                || fields['mobilenumber']          || fields['phone']
                || fields['phone number']          || fields['contact number']
                || fields['contact no']            || fields['contact.no']  || '';

            profile.fatherName = fields['father name']   || fields['father\'s name']
                || fields['fathername']                  || fields['father']
                || fields['father name.']                || '';

            profile.motherName = fields['mother name']   || fields['mother\'s name']
                || fields['mothername']                  || fields['mother']
                || fields['mother name.']                || '';

            profile.fatherMobile = fields['father mobile.no'] || fields['father mobile no']
                || fields['father mobile']                    || fields['father contact']
                || fields['father phone']                     || '';

            profile.hostel = fields['hostel']       || fields['hostel name']
                || fields['hostel block']           || '';

            profile.roomNo = fields['room.no']      || fields['room no']
                || fields['room number']            || fields['room no.']
                || fields['roomno']                 || '';

            profile.caste    = fields['caste']      || fields['caste category'] || '';
            profile.joiningDate = fields['joining date'] || fields['date of joining']
                || fields['doj']                         || '';
            profile.nationality = fields['nationality']  || '';
            profile.religion    = fields['religion']     || '';

            profile.sscMarks  = fields[' marks, %'] || fields['marks, %']
                || fields['ssc %']              || fields['ssc marks']
                || fields['ssc marks, %']       || '';
            profile.interMarks= fields['inter marks, %'] || fields['inter %']
                || fields['inter marks']             || fields['intermediate marks'] || '';

            profile.scholarship  = fields['scholarship'] || fields['scholarship type'] || '';
            profile.seatType     = fields['seat type']   || fields['type of seat']     || '';
            profile.entranceType = fields['entrance type'] || fields['entrance exam']  || '';
            profile.entranceRank = fields['eamcet/ecet rank'] || fields['rank']
                || fields['eamcet rank']  || fields['ecet rank']  || '';
            profile.aadhar = fields['aadhar.no'] || fields['aadhar no']
                || fields['aadhar']         || fields['aadhaar']  || '';

            profile.bloodGroup = fields['blood group']   || fields['bloodgroup']
                || fields['blood grp']      || fields['blood type'] || '';

            // Default section parsing
            profile.section = fields['section'] || 'A';

            // Extract academic year from semester string (e.g. "II/IV B.Tech II Semester" → "Year 2").
            // If semester is blank, leave year blank too — never invent a value.
            const semText = profile.semester;
            const yearMatch = semText.match(/^(I{1,4}|IV|V|VI|VII|VIII)\/IV/i);
            if (yearMatch) {
                const romanMap = { 'I': 1, 'II': 2, 'III': 3, 'IV': 4 };
                profile.year = `Year ${romanMap[yearMatch[1].toUpperCase()] || yearMatch[1]}`;
            } else {
                // Do NOT hardcode 'Year 1' — keep empty so callers know it wasn't extracted
                profile.year = '';
            }

            // Extract CGPA using HTML match stubs
            const html = scrapedData.profileHtml;
            const cgpaMatch = html.match(/CGPA:[\s\S]*?([\d.]+)/i);
            if (cgpaMatch) {
                profile.cgpa = parseFloat(cgpaMatch[1]).toFixed(2);
            }

            const pctMatch = html.match(/([\d.]+)\s*(?:&nbsp;|\s)*%/);
            if (pctMatch) {
                profile.percentage = parseFloat(pctMatch[1]).toFixed(2) + '%';
            }

            // Permanent Address parsing
            const addrTd = $('td:contains("Permanent Address")').next().next();
            if (addrTd.length) {
                profile.address = addrTd.text().trim().replace(/\n+/g, ', ').replace(/\s+/g, ' ');
            }

            // Guardian Details parsing
            let guardianSectionStarted = false;
            $('tr').each((i, tr) => {
                const text = $(tr).text().toLowerCase();
                if (text.includes('guardian details')) {
                    guardianSectionStarted = true;
                    return;
                }
                if (guardianSectionStarted && text.includes("parent's details")) {
                    guardianSectionStarted = false;
                    return;
                }

                if (guardianSectionStarted) {
                    const tds = $(tr).find('td');
                    for (let j = 0; j < tds.length - 2; j++) {
                        const label = $(tds[j]).text().trim().toLowerCase();
                        const sep   = $(tds[j + 1]).text().trim();
                        if (sep === ':') {
                            const value = $(tds[j + 2]).text().trim();
                            if (value) {
                                if (label === 'name') {
                                    profile.guardianName = value;
                                } else if (label === 'phone' || label === 'mobile') {
                                    profile.guardianPhone = value;
                                } else if (label === 'address') {
                                    profile.guardianAddress = value.replace(/\n+/g, ', ').replace(/\s+/g, ' ');
                                }
                            }
                        }
                    }
                }
            });

            // Student Photo parsing
            try {
                const photoImg = $('img[src*="images/StudentPhotos"], img[src*="StudentPhotos/"], img[src*="/images/"], img[src*="images/"]');
                if (photoImg.length) {
                    const src = photoImg.attr('src');
                    if (src && !src.includes('imgna.gif')) {
                        const base = (process.env.ERP_BASE_URL || 'https://sitamecap.co.in/SATYA').replace(/\/$/, '');
                        const cleanSrc = src.replace(/^\.\.\//, '').replace(/^\//, '');
                        profile.photoUrl = src.startsWith('http') ? src : `${base}/${cleanSrc}`;
                    }
                }
            } catch (photoErr) {
                logger.warn(`[Scraper] Photo url extraction failed: ${photoErr.message}`);
            }

            logger.info('[Scraper] Successfully parsed profile for student: %s (%s)', profile.name, profile.roll);
        } catch (e) {
            logger.error('[Scraper] Profile parsing error: %s', e.message, { stack: e.stack });
        }

        return profile;
    }

    // Parse marks and attendance from marksHtml safely
    parseMarks(scrapedData) {
        const results = {
            cgpa: '--', sgpa: '--', percentage: '--',
            subjects: [], attendance: [], overallAttendance: '--'
        };

        if (!scrapedData.marksHtml) {
            logger.warn('[Scraper] parseMarks: No marksHtml available');
            return results;
        }

        try {
            const $ = cheerio.load(scrapedData.marksHtml);
            const html = scrapedData.marksHtml;

            // CGPA / GPA string matches
            const cgpaMatch = html.match(/CGPA:[\s\S]*?([\d.]+)/i);
            if (cgpaMatch) results.cgpa = parseFloat(cgpaMatch[1]).toFixed(2);

            const cgpaSummaryMatch = html.match(/CGPA:[\s\S]*?([\d.]+)\s*(?:&nbsp;|\s)*%/i);
            if (cgpaSummaryMatch) {
                results.percentage = parseFloat(cgpaSummaryMatch[1]).toFixed(2) + '%';
            }

            $('table').each((ti, table) => {
                const rows = $(table).find('tr');
                if (rows.length < 2) return;

                const headerTds = $(rows[0]).find('td');
                const headers = [];
                headerTds.each((j, td) => headers.push($(td).text().trim()));

                const row1Tds = $(rows[1]).find('td');
                const firstCell = row1Tds.first().text().trim();
                const firstBold = $(row1Tds.first()).find('b').text().trim();

                // Grade / Results Table Parsing
                if (firstCell === 'Grade' || firstBold === 'Grade') {
                    logger.info('[Scraper] Found Grade Table with %d headers', headers.length);
                    for (let j = 1; j < headers.length; j++) {
                        const subjectCode = this.normalizeSubjectCode(headers[j]);
                        const grade = $(row1Tds[j]).text().trim().toUpperCase();

                        if (subjectCode === 'SGPA') {
                            results.sgpa = grade;
                            continue;
                        }
                        
                        if (!subjectCode || subjectCode === '\u00a0' || subjectCode === 'TOTAL') continue;

                        let credits = '3.0';
                        if (rows.length >= 3) {
                            const creditTds = $(rows[2]).find('td');
                            if (j < creditTds.length) {
                                credits = $(creditTds[j]).text().trim() || '3.0';
                            }
                        }

                        results.subjects.push({
                            name: subjectCode,
                            grade,
                            credits,
                            type: subjectCode.includes('LAB') || subjectCode.includes('PRACTICAL') ? 'Lab' : 'Core'
                        });
                    }
                }

                // Attendance Table Parsing
                if (firstCell === 'Subject' || headers[0] === 'Subject') {
                    logger.info('[Scraper] Found Attendance Table with %d headers', headers.length);
                    let heldRow = null, attendRow = null, pctRow = null;
                    
                    rows.each((ri, row) => {
                        const fc = $(row).find('td').first().text().trim().toLowerCase();
                        if (fc === 'held') heldRow = row;
                        else if (fc === 'attend' || fc === 'attended') attendRow = row;
                        else if (fc === '%' || fc === 'percentage') pctRow = row;
                    });

                    if (heldRow && attendRow && pctRow) {
                        const heldTds = $(heldRow).find('td');
                        const attendTds = $(attendRow).find('td');
                        const pctTds = $(pctRow).find('td');

                        for (let j = 1; j < headers.length; j++) {
                            const subj = this.normalizeSubjectCode(headers[j]);

                            if (subj === 'TOTAL' || j === headers.length - 1) {
                                const totalPct = $(pctTds[j]).text().trim();
                                if (totalPct && parseFloat(totalPct) > 0) {
                                    results.overallAttendance = parseFloat(totalPct).toFixed(2) + '%';
                                }
                                if (subj === 'TOTAL') continue;
                            }

                            if (!subj || subj === '\u00a0') continue;

                            const held = parseInt($(heldTds[j]).text().trim()) || 0;
                            const attended = parseInt($(attendTds[j]).text().trim()) || 0;
                            const pct = held > 0 ? parseFloat(((attended / held) * 100).toFixed(2)) : 0;

                            let status = 'Excellent';
                            if (pct < 65) status = 'Warning';
                            else if (pct < 75) status = 'Acceptable';
                            else if (pct < 85) status = 'Good';

                            results.attendance.push({
                                name: subj,
                                held,
                                attended,
                                total: held,
                                percentage: pct,
                                status
                            });
                        }
                    }
                }
            });

            logger.info('[Scraper] Parsed Marks: CGPA=%s, SGPA=%s, Subjects=%d, AttendanceRecords=%d', 
                results.cgpa, results.sgpa, results.subjects.length, results.attendance.length);

        } catch (e) {
            logger.error('[Scraper] Marks parsing error: %s', e.message, { stack: e.stack });
        }

        return results;
    }

    parseAttendance(scrapedData) {
        const marksData = this.parseMarks(scrapedData);
        return {
            overall: marksData.overallAttendance || '0%',
            subjects: marksData.attendance
        };
    }

    // Parse fees safely with robust index offsets
    parseFees(scrapedData) {
        const fees = {
            totalAmount: '--', paidAmount: '--', dueAmount: '--',
            totalDue: '--', paidProgress: 0, transactions: []
        };

        const htmlSources = [scrapedData.feesHtml, scrapedData.profileHtml].filter(Boolean);
        if (htmlSources.length === 0) {
            logger.warn('[Scraper] parseFees: No fee HTML available');
            return fees;
        }

        try {
            for (const html of htmlSources) {
                const $ = cheerio.load(html);
                let foundGrandTotal = false;

                // Find Grand Totals
                $('td').each((i, td) => {
                    const text = $(td).text().trim().toUpperCase();
                    if (text === 'GRAND TOTALS' || text === 'GRAND TOTAL') {
                        foundGrandTotal = true;
                        const row = $(td).closest('tr');
                        const tds = row.find('td');
                        
                        if (tds.length >= 8) {
                            fees.totalAmount = '₹' + $(tds[3]).text().trim().replace(/₹/g, '');
                            fees.paidAmount = '₹' + $(tds[4]).text().trim().replace(/₹/g, '');
                            fees.dueAmount = '₹' + $(tds[7]).text().trim().replace(/₹/g, '');
                            fees.totalDue = fees.dueAmount;
                        }
                    }
                });

                if (!foundGrandTotal) continue;

                // Parse transactions/lines
                $('tr[align="left"]').each((i, tr) => {
                    const tds = $(tr).find('td');
                    const firstText = $(tds[0]).text().trim();

                    if (/^\d+$/.test(firstText) && tds.length >= 5) {
                        const feeName = $(tds[1]).text().trim();
                        const payable = $(tds[4]).text().trim().replace(/₹/g, '');
                        const paidTd = $(tds[5]).text().trim().replace(/₹/g, '');
                        const dueTd = tds.length > 8 ? $(tds[8]).text().trim().replace(/₹/g, '') : '';
                        const recNo = tds.length > 6 ? $(tds[6]).text().trim() : '';
                        const recDate = tds.length > 7 ? $(tds[7]).text().trim() : '';

                        if (feeName) {
                            const isNull = (v) => !v || v === '\u00a0' || v.trim() === '';
                            const dueVal = isNull(dueTd) ? '0' : dueTd;
                            
                            fees.transactions.push({
                                title: feeName,
                                amount: '₹' + payable,
                                paid: !isNull(paidTd) ? '₹' + paidTd : '₹0',
                                due: '₹' + dueVal,
                                ref: !isNull(recNo) ? recNo : '--',
                                date: !isNull(recDate) ? recDate : '--',
                                icon: feeName.toLowerCase().includes('hostel') ? 'hotel' :
                                      feeName.toLowerCase().includes('tuition') ? 'school' :
                                      feeName.toLowerCase().includes('crt') ? 'terminal' : 'receipt_long',
                                status: parseFloat(dueVal) > 0 ? 'Due' : 'Paid',
                                isRefund: false
                            });
                        }
                    }
                });

                // Calculate progress safely
                const paidNum = parseFloat(fees.paidAmount.replace(/[^\d.]/g, '')) || 0;
                const totalNum = parseFloat(fees.totalAmount.replace(/[^\d.]/g, '')) || 1;
                fees.paidProgress = Math.min(100, Math.max(0, Math.round((paidNum / totalNum) * 100)));

                logger.info('[Scraper] Parsed Fees: Total=%s, Paid=%s, Due=%s, TransactionsCount=%d',
                    fees.totalAmount, fees.paidAmount, fees.dueAmount, fees.transactions.length);
                break; // Stop at first successful source
            }
        } catch (e) {
            logger.error('[Scraper] Fees parsing error: %s', e.message, { stack: e.stack });
        }

        return fees;
    }

    // Parse assignments safely
    parseAssignments(scrapedData) {
        const assignments = { activeCount: 0, list: [] };
        if (!scrapedData.assignmentsHtml) {
            logger.warn('[Scraper] parseAssignments: No assignmentsHtml available');
            return assignments;
        }

        try {
            const $ = cheerio.load(scrapedData.assignmentsHtml);

            // Check if no assignments message present
            const text = $('body').text().trim();
            if (text.toLowerCase().includes('no assignment')) {
                logger.info('[Scraper] Assignments: No assignments present on ERP.');
                return assignments;
            }

            $('table tr').each((i, tr) => {
                if (i === 0) return; // Skip header
                const tds = $(tr).find('td');
                if (tds.length >= 2) {
                    const title = $(tds[0]).text().trim();
                    // Skip if table headers are matched in content rows
                    if (title && title.length > 2 && !/^(Sl\.?No|S\.?No|#|Subject|Title)/i.test(title)) {
                        assignments.list.push({
                            title,
                            subject: $(tds[1]).text().trim() || '--',
                            status: tds.length > 2 ? $(tds[2]).text().trim() : 'Pending',
                            date: tds.length > 3 ? $(tds[tds.length - 1]).text().trim() : '--',
                            icon: 'assignment',
                            color: 'secondary'
                        });
                    }
                }
            });

            assignments.activeCount = assignments.list.length;
            logger.info('[Scraper] Parsed Assignments Count: %d', assignments.activeCount);
        } catch (e) {
            logger.error('[Scraper] Assignments parsing error: %s', e.message, { stack: e.stack });
        }

        return assignments;
    }
}

module.exports = { ERPScraper: new ERPScraper(), SessionExpiredError };
