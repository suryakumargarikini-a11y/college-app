/**
 * SITAM Smart ERP — Mock ERP Provider
 *
 * Deterministic test provider that returns realistic-looking fixture data
 * for ALL interface methods. Used in:
 *   - Integration tests (no ERP access needed)
 *   - Local development environments
 *   - CI/CD pipelines
 *
 * USAGE:
 *   Set ERP_PROVIDER=mock in .env to activate.
 *   Never use in production — ProviderFactory prevents this.
 */

'use strict';

const ERPProvider = require('../interfaces/ERPProvider');
const {
    ProfileRecord, AttendanceResult, MarksResult, FeeResult,
    AssignmentResult, ExamResult, NotificationRecord, TimetableRecord, SyncResult
} = require('../../models/normalized');
const providerMetrics = require('../telemetry/ProviderMetrics');

const MOCK_DELAY_MS = process.env.MOCK_PROVIDER_DELAY ? parseInt(process.env.MOCK_PROVIDER_DELAY) : 200;

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

class MockERPProvider extends ERPProvider {
    get providerName() {
        return 'mock';
    }

    async login({ userId, password }) {
        const startMs = Date.now();
        await delay(MOCK_DELAY_MS);
        if (password === 'wrong' || password === 'invalid') {
            providerMetrics.recordOperation(this.providerName, 'login', 'error', Date.now() - startMs);
            const { AuthenticationError } = require('../errors');
            throw new AuthenticationError('Mock: Invalid credentials', { providerName: 'mock', operationName: 'login' });
        }
        providerMetrics.recordOperation(this.providerName, 'login', 'success', Date.now() - startMs);
        return {
            sessionId:   `mock-session-${userId}-${Date.now()}`,
            cookies:     `mock_session=${userId}; Path=/; Secure; HttpOnly`,
            expiresAt:   new Date(Date.now() + 25 * 60 * 1000),
            studentName: 'Test Student'
        };
    }

    async refreshSession(session) {
        await delay(50);
        return { cookies: session.cookies, expiresAt: new Date(Date.now() + 25 * 60 * 1000), refreshed: true };
    }

    async logout(studentId) {
        return { success: true };
    }

    async getAttendance(studentId, options = {}) {
        await delay(MOCK_DELAY_MS);
        return new AttendanceResult({
            records: [
                { subjectCode: 'CS-401', subjectName: 'Data Structures', held: 40, attended: 36, percentage: 90, status: 'Excellent' },
                { subjectCode: 'CS-402', subjectName: 'Operating Systems', held: 38, attended: 28, percentage: 73.68, status: 'Acceptable' },
                { subjectCode: 'CS-403', subjectName: 'Database Management', held: 35, attended: 32, percentage: 91.43, status: 'Excellent' },
                { subjectCode: 'CS-404', subjectName: 'Computer Networks', held: 30, attended: 21, percentage: 70, status: 'Acceptable' },
                { subjectCode: 'CS-405', subjectName: 'Software Engineering', held: 28, attended: 25, percentage: 89.29, status: 'Excellent' }
            ],
            overallPercentage: '82.88%'
        });
    }

    async getMarks(studentId, options = {}) {
        await delay(MOCK_DELAY_MS);
        return new MarksResult({
            subjects: [
                { subjectCode: 'CS-401', subjectName: 'Data Structures', grade: 'A', credits: '4.0', type: 'Core', status: 'Pass' },
                { subjectCode: 'CS-402', subjectName: 'Operating Systems', grade: 'B+', credits: '3.0', type: 'Core', status: 'Pass' },
                { subjectCode: 'CS-403', subjectName: 'Database Management', grade: 'A+', credits: '4.0', type: 'Core', status: 'Pass' },
                { subjectCode: 'CS-404', subjectName: 'Computer Networks', grade: 'B', credits: '3.0', type: 'Core', status: 'Pass' },
                { subjectCode: 'CS-405', subjectName: 'Software Engineering', grade: 'A', credits: '3.0', type: 'Core', status: 'Pass' }
            ],
            cgpa: '8.75',
            sgpa: '8.90',
            percentage: '87.50%'
        });
    }

    async getFees(studentId, options = {}) {
        await delay(MOCK_DELAY_MS);
        return new FeeResult({
            transactions: [
                { title: 'Tuition Fee', amount: '85000', paidAmount: '85000', dueAmount: '0', dueDate: '--', paymentStatus: 'Paid', ref: 'TXN2024001' },
                { title: 'Hostel Fee', amount: '45000', paidAmount: '45000', dueAmount: '0', dueDate: '--', paymentStatus: 'Paid', ref: 'TXN2024002' },
                { title: 'Development Fee', amount: '15000', paidAmount: '0', dueAmount: '15000', dueDate: 'May 31, 2026', paymentStatus: 'Due', ref: '--' }
            ],
            totalAmount: '₹1,45,000',
            paidAmount:  '₹1,30,000',
            dueAmount:   '₹15,000',
            paidProgress: 89
        });
    }

    async getAssignments(studentId, options = {}) {
        await delay(MOCK_DELAY_MS);
        return new AssignmentResult({
            list: [
                { title: 'B-Tree Implementation', subject: 'CS-401', status: 'Submitted', date: 'May 10, 2026' },
                { title: 'Process Scheduling Simulation', subject: 'CS-402', status: 'Pending', date: 'June 5, 2026' },
                { title: 'ER Diagram Design', subject: 'CS-403', status: 'Urgent', date: 'June 3, 2026' }
            ]
        });
    }

    async getExams(studentId, options = {}) {
        await delay(MOCK_DELAY_MS);
        return new ExamResult({
            schedules: [
                { subjectCode: 'CS-401', subjectName: 'Data Structures', date: 'June 15, 2026', time: '09:00 AM', type: 'Semester Exam', hall: 'Block A', seatNumber: 'A101' },
                { subjectCode: 'CS-402', subjectName: 'Operating Systems', date: 'June 17, 2026', time: '09:00 AM', type: 'Semester Exam', hall: 'Block A', seatNumber: 'A101' }
            ],
            semester:    'IV Semester',
            examName:    'Regular Semester Exams',
            academicYear:'2025-2026'
        });
    }

    async getNotifications(studentId, options = {}) {
        return [
            NotificationRecord.create({ id: 'mock-1', title: 'Mock Notification', message: 'This is a test notification from Mock Provider.', date: new Date().toLocaleDateString('en-IN'), type: 'general' })
        ];
    }

    async getAnnouncements(studentId, options = {}) {
        return [
            NotificationRecord.create({ id: 'ann-1', title: 'Semester Exams Schedule', message: 'Regular semester examinations will commence from June 15, 2026.', date: 'June 1, 2026', type: 'announcement' })
        ];
    }

    async syncStudent(userId, password) {
        const startMs = Date.now();
        try {
            await delay(MOCK_DELAY_MS * 2);

            // Reuse individual getters for DRY mock data
            const [attendance, marks, fees, assignments, exams, notifications] = await Promise.all([
                this.getAttendance(userId),
                this.getMarks(userId),
                this.getFees(userId),
                this.getAssignments(userId),
                this.getExams(userId),
                this.getNotifications(userId)
            ]);

            const profile = ProfileRecord.create({
                name:       'Test Student',
                roll:       userId,
                program:    'B.Tech',
                branch:     'Computer Science & Engineering',
                semester:   'IV/IV B.Tech II Semester',
                section:    'A',
                cgpa:       marks.cgpa,
                percentage: marks.percentage
            });

            const durationMs = Date.now() - startMs;
            providerMetrics.recordOperation(this.providerName, 'syncStudent', 'success', durationMs);
            providerMetrics.recordSyncSuccess(this.providerName, 'full');
            providerMetrics.setHealthScore(this.providerName, 100);

            return new SyncResult({
                profile, marks, attendance, fees, assignments, notifications,
                timetable:  [],
                syncType:   'full',
                provider:   this.providerName,
                syncedAt:   new Date().toISOString()
            });
        } catch (err) {
            const durationMs = Date.now() - startMs;
            providerMetrics.recordOperation(this.providerName, 'syncStudent', 'error', durationMs);
            providerMetrics.recordSyncFailure(this.providerName, 'full', err.constructor.name);
            providerMetrics.setHealthScore(this.providerName, 50);
            throw err;
        }
    }

    async syncIncremental(userId, password, session) {
        const startMs = Date.now();
        try {
            const result = await this.syncStudent(userId, password);
            result.syncType = 'incremental';
            
            const durationMs = Date.now() - startMs;
            providerMetrics.recordOperation(this.providerName, 'syncIncremental', 'success', durationMs);
            providerMetrics.recordSyncSuccess(this.providerName, 'incremental');
            return result;
        } catch (err) {
            const durationMs = Date.now() - startMs;
            providerMetrics.recordOperation(this.providerName, 'syncIncremental', 'error', durationMs);
            providerMetrics.recordSyncFailure(this.providerName, 'incremental', err.constructor.name);
            throw err;
        }
    }

    async openPaymentWindow(userId, password) {
        // Mock implementation — simulate payment window success
        const logger = require('../../services/logger');
        logger.info(`[MockERPProvider] Mocked headed payment window opened successfully for user: ${userId}`);
        return { success: true, mode: 'mock' };
    }

    async checkERPHealth() {
        return { healthy: true, responseTimeMs: MOCK_DELAY_MS, provider: this.providerName, details: { mode: 'mock' } };
    }

    async validateSession(studentId, session) {
        return { valid: true, expiresAt: new Date(Date.now() + 25 * 60 * 1000) };
    }
}

module.exports = new MockERPProvider();
