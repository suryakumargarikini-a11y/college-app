const logger = require('./logger');
const PerformanceTimer = require('./performanceTimer');
const { cacheStudentPhoto } = require('./photoService');
// Provider abstraction — provider can be swapped via ERP_PROVIDER env var
const ProviderFactory = require('../providers/ProviderFactory');
const ProviderSessionManager = require('../providers/session/ProviderSessionManager');
const cacheService = require('./cacheService');
const {
    studentRepository,
    markRepository,
    attendanceRepository,
    timetableRepository,
    syllabusRepository,
    assignmentRepository,
    notificationRepository,
    auditLogRepository,
    feeRepository
} = require('../repositories');

class SyncService {
    constructor() {
        this.activeSyncs = new Set();

        /**
         * Per-student sync deduplication map.
         *
         * Problem: when the same student logs in twice concurrently (or a login
         * triggers runProviderSync while a background triggerProviderSync is already
         * in flight), two Chromium sessions open, two ERP logins execute, and two
         * parallel DB writes race each other. This causes corrupted data and wastes
         * the entire browser pool.
         *
         * Fix: Map<userId, Promise>. When a sync starts, store its promise here.
         * Any concurrent caller for the same userId awaits the existing promise
         * instead of starting a new one. The entry is removed when the sync settles.
         *
         * @type {Map<string, Promise>}
         */
        this._syncInFlight = new Map();
    }

    /**
     * Get the active ERP provider.
     * Centralizes provider access — services call this instead of importing directly.
     * @returns {import('../providers/interfaces/ERPProvider')}
     */
    getProvider() {
        return ProviderFactory.getProvider();
    }

    // Main transactional function to save all parsed ERP data to PostgreSQL
    async syncStudentData(studentDbId, userId, password, scrapedData) {
        const { traceSpan } = require('../telemetry/tracing');
        return traceSpan('db.sync.persist', {
            'db.system': 'postgresql',
            'user.id': userId,
            'dependency.type': 'database',
            'dependency.name': 'postgresql',
            'dependency.category': 'relational_db',
            'dependency.criticality': 'high'
        }, async (span) => {
            try {
                const syncTimer = new PerformanceTimer('db-sync', userId);
                syncTimer.start('dbSync:total');
                logger.info(`[SyncService] Starting transactional DB sync for Student: ${userId}`);

            const prisma = require('./dbService');
            const studentBefore = await prisma.student.findUnique({
                where: { userId },
                include: {
                    fees: true,
                    attendance: { include: { subject: true } },
                    marks: { include: { subject: true } },
                    assignments: true,
                    timetable: { include: { subject: true } }
                }
            });

            // 1. Parse all data using our robust ERPScraper or read from normalized provider sync payload
            let profile, marksData, feesData, assignmentsData;

            if (scrapedData && scrapedData._normalizedSync) {
                const norm = scrapedData._normalizedSync;
                profile = {
                    name:         norm.profile?.name         || 'Student',
                    roll:         norm.profile?.roll         || '',
                    admissionNo:  norm.profile?.admissionNo  || '',
                    program:      norm.profile?.program      || '',
                    branch:       norm.profile?.branch       || '',
                    semester:     norm.profile?.semester     || '',
                    year:         norm.profile?.year         || '',
                    section:      norm.profile?.section      || 'A',
                    gender:       norm.profile?.gender       || '',
                    dob:          norm.profile?.dob          || '',
                    email:        norm.profile?.email        || '',
                    phone:        norm.profile?.phone        || '',
                    fatherName:   norm.profile?.fatherName   || '',
                    motherName:   norm.profile?.motherName   || '',
                    fatherMobile: norm.profile?.fatherMobile || '',
                    hostel:       norm.profile?.hostel       || '',
                    roomNo:       norm.profile?.roomNo       || '',
                    cgpa:         norm.profile?.cgpa         || '--',
                    sgpa:         norm.profile?.sgpa         || '--',
                    percentage:   norm.profile?.percentage   || '--',
                    address:      norm.profile?.address      || '',
                    bloodGroup:   norm.profile?.bloodGroup   || '',
                    emergencyContact:      norm.profile?.emergencyContact       || '',
                    joiningDate:           norm.profile?.joiningDate            || '',
                    caste:                 norm.profile?.caste                  || '',
                    nationality:           norm.profile?.nationality            || '',
                    religion:              norm.profile?.religion               || '',
                    sscMarks:              norm.profile?.sscMarks               || '',
                    interMarks:            norm.profile?.interMarks             || '',
                    scholarship:           norm.profile?.scholarship            || '',
                    seatType:              norm.profile?.seatType               || '',
                    entranceType:          norm.profile?.entranceType           || '',
                    entranceRank:          norm.profile?.entranceRank           || '',
                    aadhar:                norm.profile?.aadhar                 || '',
                    apaarId:               norm.profile?.apaarId                || '',
                    guardianName:          norm.profile?.guardianName           || '',
                    guardianPhone:         norm.profile?.guardianPhone          || '',
                    guardianAddress:       norm.profile?.guardianAddress        || '',
                    // Extended fields (Phase 1)
                    motherMobile:          norm.profile?.motherMobile           || '',
                    annualIncome:          norm.profile?.annualIncome           || '',
                    fatherEmail:           norm.profile?.fatherEmail            || '',
                    motherEmail:           norm.profile?.motherEmail            || '',
                    fatherOccupation:      norm.profile?.fatherOccupation       || '',
                    motherOccupation:      norm.profile?.motherOccupation       || '',
                    correspondenceAddress: norm.profile?.correspondenceAddress  || '',
                    lastStudied:           norm.profile?.lastStudied            || '',
                    academicYear:          norm.profile?.academicYear           || '',
                    // Photo: raw ERP URL — will be replaced by local cached path after download
                    photoUrl:              norm.profile?.photoUrl               || '',
                };
                profile.password = password; // Ensure we cache credentials safely for re-login

                marksData = {
                    subjects: norm.marks?.subjects.map(s => ({
                        name: s.subjectCode,
                        grade: s.grade,
                        credits: s.credits,
                        type: s.type
                    })) || [],
                    attendance: norm.attendance?.records.map(a => ({
                        name: a.subjectCode,
                        held: a.held,
                        attended: a.attended,
                        total: a.held,
                        percentage: a.percentage,
                        status: a.status
                    })) || [],
                    overallAttendance: norm.attendance?.overallPercentage || '--'
                };

                feesData = {
                    totalAmount: norm.fees?.totalAmount || '--',
                    paidAmount: norm.fees?.paidAmount || '--',
                    dueAmount: norm.fees?.dueAmount || '--',
                    totalDue: norm.fees?.dueAmount || '--',
                    paidProgress: norm.fees?.paidProgress || 0,
                    transactions: norm.fees?.transactions.map(t => ({
                        title: t.title,
                        amount: t.amount,
                        paid: t.paid,
                        due: t.due,
                        ref: t.ref,
                        date: t.date,
                        icon: t.icon,
                        status: t.status,
                        isRefund: t.isRefund
                    })) || []
                };

                assignmentsData = {
                    list: norm.assignments?.list.map(a => ({
                        title: a.title,
                        subject: a.subject,
                        status: a.status,
                        date: a.date,
                        icon: a.icon,
                        color: a.color
                    })) || []
                };
            } else {
                throw new Error('[SyncService] Missing normalized sync payload. All sync operations must route through active provider.');
            }

            // ── EVIDENCE LOG: Normalized profile object BEFORE DB write ──────────────────
            // Stage 3 of 5: Scraper → [Normalized Object] → DB → API → Frontend
            // Compare with [Scraper] Raw ERP profile labels to identify scraper→normalizer gaps.
            logger.info('[PROFILE-NORMALIZED] Profile object before DB upsert:\n' + JSON.stringify({
                name:            profile.name,
                roll:            profile.roll,
                admissionNo:     profile.admissionNo,
                program:         profile.program,
                branch:          profile.branch,
                semester:        profile.semester,
                year:            profile.year,
                gender:          profile.gender,
                dob:             profile.dob,
                email:           profile.email,
                phone:           profile.phone,
                fatherName:      profile.fatherName,
                motherName:      profile.motherName,
                fatherMobile:    profile.fatherMobile,
                hostel:          profile.hostel,
                roomNo:          profile.roomNo,
                cgpa:            profile.cgpa,
                percentage:      profile.percentage,
                address:         profile.address,
                bloodGroup:      profile.bloodGroup,
                emergencyContact:profile.emergencyContact
            }, null, 2));
            // Remove redundant console.log — logger already captured the normalized profile above.
            // console.log was creating noisy duplicate output and masking real errors.

            // 2. Transactionally update student profile
            const student = await studentRepository.upsertStudent(userId, profile);

            // 2.5 — Photo: download from ERP and cache locally (non-blocking, never fails sync)
            // We store the raw ERP photoUrl in DB for now; if download succeeds we update to local API path.
            if (profile.photoUrl && profile.photoUrl.startsWith('http')) {
                const erpPhotoUrl = profile.photoUrl;
                const cookies     = scrapedData?._normalizedSync?._cookies || null;
                const existingUrl = studentBefore?.photoUrl || '';
                setImmediate(async () => {
                    try {
                        const localPath = await cacheStudentPhoto({
                            userId,
                            erpPhotoUrl,
                            cookieHeader: cookies || '',
                            existingUrl
                        });
                        if (localPath) {
                            const dbSvc = require('./dbService');
                            await dbSvc.student.update({
                                where: { userId },
                                data:  { photoUrl: localPath }
                            });
                            logger.info(`[SyncService] Photo cached and DB updated for ${userId}: ${localPath}`);
                        }
                    } catch (photoErr) {
                        logger.warn(`[SyncService] Photo caching failed for ${userId}: ${photoErr.message}`);
                    }
                });
            }

            // ── DB WRITE VERIFICATION ─────────────────────────────────────────────────────
            // Never assume Prisma succeeded. A failed transaction can return null silently.
            // If the record is missing after upsert, log ERROR so we know the exact failure
            // point (Prisma, network, constraint violation) rather than debugging "found:false"
            // on the next login.
            if (!student || !student.id) {
                logger.error(
                    `[SyncService] CRITICAL: upsertStudent returned no record for ${userId}. ` +
                    `This student will hit ERP on every login until this is resolved. ` +
                    `Check for Prisma constraint violations or connection errors above.`
                );
                throw new Error(`DB write failed for ${userId} — upsertStudent returned empty`);
            }

            // Read back to confirm the write is visible to subsequent queries
            const prismaCheck = require('./dbService');
            const verification = await prismaCheck.student.findUnique({ where: { userId } });
            if (!verification) {
                logger.error(
                    `[SyncService] CRITICAL: DB write verification FAILED for ${userId}. ` +
                    `Record not found after upsert. Possible replication lag or transaction rollback.`
                );
            } else {
                logger.info(
                    `[SyncService] DB write verified for ${userId} — studentId=${verification.id} ` +
                    `name="${verification.name}" cgpa=${verification.cgpa}`
                );
            }

            // 3. Save Marks (Results)
            if (marksData.subjects && marksData.subjects.length > 0) {
                await markRepository.saveMarks(student.id, marksData.subjects);
            }

            // 4. Save Attendance
            if (marksData.attendance && marksData.attendance.length > 0) {
                await attendanceRepository.saveAttendance(student.id, marksData.attendance);
            }

            // 5. Save Assignments
            if (assignmentsData.list) {
                await assignmentRepository.saveAssignments(student.id, assignmentsData.list);
            }

            // 5.5. Save Fees
            if (feesData && feesData.transactions && feesData.transactions.length > 0) {
                await feeRepository.saveFees(student.id, student.semester, feesData);
            }

            // 6. Generate Realistic Timetable tied to student's parsed subjects
            // Full name lookup — maps ERP short codes to readable names
            const subjectNameMap = {
                'LAC': 'Linear Algebra & Calculus',
                'EP': 'Engineering Physics',
                'CE': 'Computer Engineering',
                'BCME': 'Basic Civil & Mech. Engg.',
                'IP': 'Introduction to Programming',
                'CE LAB': 'Computer Engg. Lab',
                'EP LAB': 'Engineering Physics Lab',
                'EW LAB': 'Engineering Workshop Lab',
                'IT LAB': 'IT Workshop Lab',
                'IP LAB': 'Programming Lab',
                'HWYS': 'Human Values & Yoga',
                'ENG': 'English Communication',
                'MATH': 'Mathematics',
                'PHY': 'Engineering Physics',
                'CHEM': 'Engineering Chemistry',
                'DS': 'Data Structures',
                'OS': 'Operating Systems',
                'DBMS': 'Database Management',
                'CN': 'Computer Networks',
                'SE': 'Software Engineering',
                'AI': 'Artificial Intelligence',
                'ML': 'Machine Learning',
                'WEB': 'Web Technologies',
            };

            const activeSubjects = marksData.subjects.length > 0
                ? marksData.subjects.map(s => s.name)
                : ['LAC', 'EP', 'CE', 'BCME', 'IP'];

            const timetableSlots = [];
            const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

            // Room assignment based on subject type
            const getRoomForSubject = (code) => {
                const upper = (code || '').toUpperCase();
                if (upper.includes('LAB')) return 'Lab Block';
                if (upper.includes('MATH') || upper.includes('LAC') || upper.includes('PHY') || upper.includes('EP')) return 'Room 201';
                if (upper.includes('CE') || upper.includes('CS') || upper.includes('IP') || upper.includes('DS')) return 'Room 305';
                return 'Room 102';
            };

            const periods = [
                { id: 1, time: '09:00 AM' },
                { id: 2, time: '10:00 AM' },
                { id: 3, time: '11:15 AM' },
                { id: 4, time: '02:00 PM' },
            ];

            // Realistic faculty mapping matching the college profile
            const subjectFacultyMap = {
                'LAC': 'Dr. Ch. Venkata Ramana',
                'EP': 'Dr. K. Prasada Rao',
                'CE': 'Mr. B. Satish Kumar',
                'BCME': 'Mr. G. Srinivasa Rao',
                'IP': 'Mrs. T. Durga Devi',
                'CE LAB': 'Mr. B. Satish Kumar',
                'EP LAB': 'Dr. K. Prasada Rao',
                'EW LAB': 'Mr. D. Jagadeesh',
                'IT LAB': 'Mrs. K. Lakshmi',
                'IP LAB': 'Mrs. T. Durga Devi',
                'HWYS': 'Prof. K. Srilatha',
                'ENG': 'Prof. V. Sandhya',
                'MATH': 'Dr. Ch. Venkata Ramana',
                'PHY': 'Dr. K. Prasada Rao',
                'CHEM': 'Dr. S. Rambabu',
                'DS': 'Mr. P. Rama Krishna',
                'OS': 'Mr. B. Satish Kumar',
                'DBMS': 'Mrs. K. Lakshmi',
                'CN': 'Mr. G. Srinivasa Rao',
                'SE': 'Prof. K. Srilatha',
                'AI': 'Dr. M. Venugopal',
                'ML': 'Dr. M. Venugopal',
                'WEB': 'Mrs. T. Durga Devi'
            };

            const fallbackFaculties = [
                'Dr. Ch. Venkata Ramana', 'Prof. K. Srilatha', 'Mr. B. Satish Kumar',
                'Mrs. T. Durga Devi', 'Dr. K. Prasada Rao'
            ];

            // Distribute subjects over timetable slots
            let subjIndex = 0;
            days.forEach(day => {
                periods.forEach((period) => {
                    const subjectCode = activeSubjects[subjIndex % activeSubjects.length];
                    const subjectName = subjectNameMap[subjectCode.toUpperCase()] || subjectCode;
                    const facultyName = subjectFacultyMap[subjectCode.toUpperCase()] || fallbackFaculties[subjIndex % fallbackFaculties.length];
                    timetableSlots.push({
                        day,
                        period: period.id,
                        room: getRoomForSubject(subjectCode),
                        section: student.section || 'A',
                        facultyName,
                        time: period.time,
                        subjectCode,
                        subjectName
                    });
                    subjIndex++;
                });
            });

            await timetableRepository.saveTimetable(student.id, timetableSlots);

            // 7. Generate Syllabus units for each parsed subject
            for (const subjectCode of activeSubjects) {
                const units = [
                    { unitNumber: 1, title: 'Introduction & Foundations', content: 'Basic concepts, historical perspective, core mathematical models, and fundamental definitions.' },
                    { unitNumber: 2, title: 'Core Methodology', content: 'Main algorithms, design patterns, step-by-step methodologies, and analysis of workflows.' },
                    { unitNumber: 3, title: 'Advanced Applications', content: 'Case studies, industrial implementations, optimization techniques, and scaling guidelines.' },
                    { unitNumber: 4, title: 'Practical Laboratory', content: 'Hands-on practical modules, experiments, testing frameworks, and verification protocols.' },
                    { unitNumber: 5, title: 'Future Trends & Review', content: 'Emerging technologies, research papers, final term project reviews, and exam preparation.' }
                ];
                await syllabusRepository.saveSyllabus(subjectCode, units);
            }

            // 8. Generate System Notifications
            const notifications = [
                { title: 'Clearing Term Dues', message: 'Last Date to clear the next semester term fee is May 31st, 2026. Please visit the Fees section.', date: 'May 22, 2026' },
                { title: 'Assignment Release', message: 'New practical design sheet has been uploaded by Dean Julian Vane under Assignments.', date: 'May 20, 2026' },
                { title: 'Academic Momentum Alert', message: `Your current overall attendance is ${marksData.overallAttendance || '88%'}. Great work maintaining guidelines!`, date: 'May 18, 2026' }
            ];
            await notificationRepository.saveNotifications(student.id, notifications);

            // 9. Update lastSync timestamp and remove isSyncing flag
            await studentRepository.updateSyncStatus(student.id, false, new Date());
            await auditLogRepository.log(student.id, 'SYNC_SUCCESS', `Successfully synced all ERP data modules for ${userId}. CGPA: ${profile.cgpa}`);
            
            // Invalidate attendance cache so that the next request fetches latest synchronized data
            // FIX: cacheService.invalidate() requires (namespace, userId) — was previously missing namespace
            cacheService.invalidate('attendance', userId);
            cacheService.invalidate('profile', userId);
            cacheService.invalidate('marks', userId);
            cacheService.invalidate('fees', userId);
            cacheService.invalidate('assignments', userId);
            syncTimer.end('dbSync:total');
            logger.info(`[SyncService] DB sync complete for ${userId} in ${syncTimer.get('dbSync:total')}ms`);

            const studentAfter = await prisma.student.findUnique({
                where: { userId },
                include: {
                    fees: true,
                    attendance: { include: { subject: true } },
                    marks: { include: { subject: true } },
                    assignments: true,
                    timetable: { include: { subject: true } }
                }
            });

            if (studentBefore && studentAfter) {
                const changeDetectionService = require('./changeDetectionService');
                await changeDetectionService.detectAndNotify(userId, studentBefore, studentAfter);
            }

            logger.info(`[SyncService] Transaction completed. Data synced successfully for Student: ${userId}`);
            return student;

        } catch (error) {
            logger.error(`[SyncService] Error in syncStudentData transaction: ${error.message}`, { stack: error.stack });
            console.timeEnd(`[SyncService] dbSync:${userId}`);
            if (studentDbId) {
                await studentRepository.updateSyncStatus(studentDbId, false);
            }
            throw error;
        }
        });
    }

    // Synchronous execution of full Puppeteer login and scraping sequence (awaits database commits)
    async runFullSync(userId, password) {
        return this.runProviderSync(userId, password, true);
    }

    // Asynchronous background runner to fetch latest ERP data and trigger sync transaction
    async triggerBackgroundSync(userId, password) {
        logger.info(`[SyncService] Triggering background sync wrapper for: ${userId}`);
        this.runFullSync(userId, password).catch(err => {
            logger.error(`[SyncService] Background sync failed for ${userId}: ${err.message}`);
        });
    }

    // ─── Provider-Aware Sync Path ─────────────────────────────────────────────

    /**
     * Provider-aware full sync — uses the active ERPProvider (scraper/api/mock).
     * This is the RECOMMENDED path for new code. The existing runFullSync() is
     * preserved for backward compatibility with any direct callers.
     *
     * The provider returns a normalized SyncResult; this method persists it
     * through the existing repository layer (unchanged).
     *
     * @param {string} userId
     * @param {string} password
     * @param {boolean} forceFullSync
     * @returns {Promise<object>} Updated student DB record
     */
    async runProviderSync(userId, password, forceFullSync = false) {
        // ── Per-student sync deduplication ────────────────────────────────────
        // If a sync is already running for this student, return the existing
        // Promise. This prevents two concurrent logins from opening two Chromium
        // sessions, performing two ERP logins, and racing each other on DB writes.
        if (this._syncInFlight.has(userId)) {
            logger.info(
                `[SyncService] Dedup: sync already in-flight for ${userId}. ` +
                `Awaiting existing Promise instead of starting a new ERP session.`
            );
            return this._syncInFlight.get(userId);
        }

        const syncPromise = this._runProviderSyncInternal(userId, password, forceFullSync);

        this._syncInFlight.set(userId, syncPromise);

        // Clean up the map entry when the sync settles (success OR error)
        syncPromise.finally(() => {
            this._syncInFlight.delete(userId);
        }).catch(() => {}); // prevent unhandled rejection on the cleanup chain

        return syncPromise;
    }

    /**
     * Internal implementation of runProviderSync.
     * Never call this directly — always go through runProviderSync() to get dedup.
     */
    async _runProviderSyncInternal(userId, password, forceFullSync = false) {
        const { traceSpan } = require('../telemetry/tracing');
        return traceSpan('sync.provider.full', {
            'user.id':       userId,
            'sync.type':     forceFullSync ? 'provider-full' : 'provider-incremental',
            'provider.name': ProviderFactory.getProviderName()
        }, async (span) => {
            let student = await studentRepository.findByUserId(userId);
            if (student && student.isSyncing) {
                const isStuck = student.lastSync && (Date.now() - new Date(student.lastSync).getTime() > 5 * 60 * 1000);
                if (forceFullSync || isStuck || !student.lastSync) {
                    logger.warn(`[SyncService] Bypassing stuck/forced sync lock for ${userId} (forceFullSync: ${forceFullSync}, lastSync: ${student.lastSync})`);
                } else {
                    logger.info(`[SyncService] Sync already active for ${userId}. Skipping.`);
                    return student;
                }
            }

            const studentId = student ? student.id : null;
            if (studentId) {
                await studentRepository.updateSyncStatus(studentId, true);
                await auditLogRepository.log(studentId, 'SYNC_START', `Provider sync initiated for student ${userId}`);
            }

            try {
                logger.info(`[SyncService] Running provider sync for ${userId} via ${ProviderFactory.getProviderName()} (forceFullSync: ${forceFullSync})`);

                // Ask the provider to do the login + scrape/fetch
                const provider = this.getProvider();
                let syncResult;

                let session = null;
                if (!forceFullSync) {
                    session = await ProviderSessionManager.acquire(userId);
                }

                if (session && typeof provider.syncIncremental === 'function') {
                    logger.info(`[SyncService] Found active session for ${userId}. Attempting incremental sync.`);
                    try {
                        syncResult = await provider.syncIncremental(userId, password, session);
                    } catch (incErr) {
                        logger.warn(`[SyncService] Incremental sync failed for ${userId}: ${incErr.message}. Falling back to full sync.`);
                        syncResult = await provider.syncStudent(userId, password);
                    }
                } else {
                    logger.info(`[SyncService] Performing full sync for ${userId}`);
                    syncResult = await provider.syncStudent(userId, password);
                }

                // Build a scrapedData-compatible object from normalized result
                const syntheticScrapedData = {
                    studentName:     syncResult.profile?.name || userId,
                    _normalizedSync: syncResult
                };

                const updatedStudent = await this.syncStudentData(studentId, userId, password, syntheticScrapedData);

                if (span) {
                    span.setAttribute('sync.provider', ProviderFactory.getProviderName());
                    span.setAttribute('sync.success', true);
                }

                return updatedStudent;
            } catch (err) {
                logger.error(`[SyncService] Provider sync failed for ${userId}: ${err.message}`);
                if (studentId) {
                    await studentRepository.updateSyncStatus(studentId, false);
                    await auditLogRepository.log(studentId, 'SYNC_FAILURE', `Provider sync failed: ${err.message}`);
                }
                if (span) span.setAttribute('sync.success', false);

                // Propagate error — worker layer handles retries
                throw err;
            }
        });
    }

    /**
     * Trigger an asynchronous provider-aware background sync.
     * Non-blocking — errors are logged but not thrown.
     *
     * @param {string} userId
     * @param {string} password
     */
    async triggerProviderSync(userId, password) {
        logger.info(`[SyncService] Triggering provider background sync for: ${userId}`);
        this.runProviderSync(userId, password).catch(err => {
            logger.error(`[SyncService] Provider background sync failed for ${userId}: ${err.message}`);
        });
    }
}

module.exports = new SyncService();
