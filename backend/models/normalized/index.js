/**
 * SITAM Smart ERP — Normalized Data Models
 *
 * Provider-independent schemas for ALL ERP data types.
 * The service layer and controllers consume ONLY these normalized models.
 * Raw HTML, Puppeteer objects, and provider-specific structures must
 * NEVER escape the provider boundary.
 *
 * Each model exposes:
 *   - static create(raw)   — factory that normalizes raw provider data
 *   - static validate(obj) — schema validation, returns { valid, errors }
 *   - toJSON()             — safe serialization (strips internal fields)
 */

'use strict';

// ─── Utilities ───────────────────────────────────────────────────────────────

/**
 * Coerce a value to a safe float. Returns 0 if non-parseable.
 * @param {*} v
 * @returns {number}
 */
function safeFloat(v) {
    const n = parseFloat(String(v || '').replace(/[^0-9.]/g, ''));
    return isNaN(n) ? 0 : n;
}

/**
 * Coerce a value to a safe integer. Returns 0 if non-parseable.
 * @param {*} v
 * @returns {number}
 */
function safeInt(v) {
    const n = parseInt(String(v || '').replace(/[^0-9]/g, ''), 10);
    return isNaN(n) ? 0 : n;
}

/**
 * Return string or fallback.
 * @param {*} v
 * @param {string} [fallback='']
 * @returns {string}
 */
function safeStr(v, fallback = '') {
    return (v !== null && v !== undefined && v !== '') ? String(v).trim() : fallback;
}

/**
 * Normalize timestamp to ISO-8601 string or null.
 * @param {*} v
 * @returns {string|null}
 */
function safeDate(v) {
    if (!v) return null;
    try {
        const d = new Date(v);
        if (isNaN(d.getTime())) return null;
        return d.toISOString();
    } catch {
        return null;
    }
}

// ─── ProfileRecord ────────────────────────────────────────────────────────────

class ProfileRecord {
    constructor(data) {
        this.name         = safeStr(data.name, 'Student');
        this.roll         = safeStr(data.roll);
        this.admissionNo  = safeStr(data.admissionNo);
        this.program      = safeStr(data.program);
        this.branch       = safeStr(data.branch);
        this.semester     = safeStr(data.semester);
        this.year         = safeStr(data.year);
        this.section      = safeStr(data.section, 'A');
        this.gender       = safeStr(data.gender);
        this.dob          = safeStr(data.dob);
        this.email        = safeStr(data.email);
        this.phone        = safeStr(data.phone);
        this.fatherName   = safeStr(data.fatherName);
        this.motherName   = safeStr(data.motherName);
        this.fatherMobile = safeStr(data.fatherMobile);
        this.hostel       = safeStr(data.hostel);
        this.roomNo       = safeStr(data.roomNo);
        this.cgpa         = safeStr(data.cgpa, '--');
        this.sgpa         = safeStr(data.sgpa, '--');
        this.percentage   = safeStr(data.percentage, '--');
        this.address      = safeStr(data.address);
        this.joiningDate  = safeStr(data.joiningDate);
        this.nationality  = safeStr(data.nationality);
        this.religion     = safeStr(data.religion);
        this.caste        = safeStr(data.caste);
        this.sscMarks     = safeStr(data.sscMarks);
        this.interMarks   = safeStr(data.interMarks);
        this.scholarship  = safeStr(data.scholarship);
        this.seatType     = safeStr(data.seatType);
        this.entranceType = safeStr(data.entranceType);
        this.entranceRank = safeStr(data.entranceRank);
        this.bloodGroup   = safeStr(data.bloodGroup);
        this.emergencyContact = safeStr(data.emergencyContact);
        this.guardianName    = safeStr(data.guardianName);
        this.guardianPhone   = safeStr(data.guardianPhone);
        this.guardianAddress = safeStr(data.guardianAddress);
        // Extended profile fields (Phase 1)
        this.motherMobile        = safeStr(data.motherMobile);
        this.fatherEmail         = safeStr(data.fatherEmail);
        this.motherEmail         = safeStr(data.motherEmail);
        this.fatherOccupation    = safeStr(data.fatherOccupation);
        this.motherOccupation    = safeStr(data.motherOccupation);
        this.annualIncome        = safeStr(data.annualIncome);
        this.correspondenceAddress = safeStr(data.correspondenceAddress);
        this.lastStudied         = safeStr(data.lastStudied);
        this.academicYear        = safeStr(data.academicYear);
        // Sensitive — stored, controlled exposure in API
        this.aadhar   = safeStr(data.aadhar);
        this.apaarId  = safeStr(data.apaarId);
        // Photo
        this.photoUrl = safeStr(data.photoUrl);
        // Internal — never serialized
        this._password = data.password || null;
    }

    static create(raw) {
        return new ProfileRecord(raw || {});
    }

    static validate(obj) {
        const errors = [];
        if (!obj.name) errors.push('name is required');
        return { valid: errors.length === 0, errors };
    }

    toJSON() {
        const { _password, aadhar, apaarId, ...safe } = this;
        // aadhar and apaarId are excluded from default serialization.
        // The API controller adds them back only for the authenticated owner.
        return safe;
    }
}

// ─── AttendanceRecord ─────────────────────────────────────────────────────────

class AttendanceRecord {
    constructor(data) {
        this.subjectCode = safeStr(data.subjectCode || data.name || data.code);
        this.subjectName = safeStr(data.subjectName || data.subjectCode || data.name);
        this.held        = safeInt(data.held || data.total);
        this.attended    = safeInt(data.attended || data.present);
        this.percentage  = data.percentage !== undefined
            ? parseFloat(data.percentage)
            : (this.held > 0 ? parseFloat(((this.attended / this.held) * 100).toFixed(2)) : 0);
        this.status      = safeStr(data.status) || AttendanceRecord._deriveStatus(this.percentage);
        this.updatedAt   = safeDate(data.updatedAt) || new Date().toISOString();
    }

    static _deriveStatus(pct) {
        if (pct >= 85) return 'Excellent';
        if (pct >= 75) return 'Good';
        if (pct >= 65) return 'Acceptable';
        return 'Warning';
    }

    static create(raw) {
        return new AttendanceRecord(raw || {});
    }

    static validate(obj) {
        const errors = [];
        if (!obj.subjectCode) errors.push('subjectCode is required');
        if (obj.held < 0)     errors.push('held must be >= 0');
        if (obj.attended < 0) errors.push('attended must be >= 0');
        if (obj.attended > obj.held) errors.push('attended cannot exceed held');
        return { valid: errors.length === 0, errors };
    }

    toJSON() {
        return {
            subjectCode: this.subjectCode,
            subjectName: this.subjectName,
            held:        this.held,
            attended:    this.attended,
            percentage:  this.percentage,
            status:      this.status,
            updatedAt:   this.updatedAt
        };
    }
}

// ─── MarkRecord ───────────────────────────────────────────────────────────────

class MarkRecord {
    constructor(data) {
        this.subjectCode = safeStr(data.subjectCode || data.name || data.code);
        this.subjectName = safeStr(data.subjectName || data.subjectCode || data.name);
        this.grade       = safeStr(data.grade, 'N/A').toUpperCase();
        this.credits     = safeStr(data.credits, '3.0');
        this.type        = safeStr(data.type, 'Core');
        this.status      = safeStr(data.status) || MarkRecord._deriveStatus(this.grade);
        this.updatedAt   = safeDate(data.updatedAt) || new Date().toISOString();
    }

    static _deriveStatus(grade) {
        const g = (grade || '').toUpperCase();
        if (g === 'F' || g === 'BACKLOG') return 'Backlog';
        if (g === 'ABSENT' || g === 'AB') return 'Absent';
        return 'Pass';
    }

    static create(raw) {
        return new MarkRecord(raw || {});
    }

    static validate(obj) {
        const errors = [];
        if (!obj.subjectCode) errors.push('subjectCode is required');
        return { valid: errors.length === 0, errors };
    }

    toJSON() {
        return {
            subjectCode: this.subjectCode,
            subjectName: this.subjectName,
            grade:       this.grade,
            credits:     this.credits,
            type:        this.type,
            status:      this.status,
            updatedAt:   this.updatedAt
        };
    }
}

// ─── SubjectRecord ────────────────────────────────────────────────────────────

class SubjectRecord {
    constructor(data) {
        this.code     = safeStr(data.code || data.subjectCode).toUpperCase();
        this.name     = safeStr(data.name || data.subjectName || data.code);
        this.credits  = safeStr(data.credits, '3.0');
        this.semester = safeStr(data.semester);
        this.branch   = safeStr(data.branch);
    }

    static create(raw) {
        return new SubjectRecord(raw || {});
    }

    static validate(obj) {
        const errors = [];
        if (!obj.code) errors.push('code is required');
        return { valid: errors.length === 0, errors };
    }

    toJSON() {
        return {
            code:     this.code,
            name:     this.name,
            credits:  this.credits,
            semester: this.semester,
            branch:   this.branch
        };
    }
}

// ─── TimetableRecord ─────────────────────────────────────────────────────────

class TimetableRecord {
    constructor(data) {
        this.day         = safeStr(data.day);
        this.period      = safeInt(data.period);
        this.time        = safeStr(data.time);
        this.subjectCode = safeStr(data.subjectCode || data.code).toUpperCase();
        this.subjectName = safeStr(data.subjectName || data.subjectCode || data.code);
        this.room        = safeStr(data.room, 'TBA');
        this.section     = safeStr(data.section, 'A');
        this.facultyName = safeStr(data.facultyName, 'TBA');
    }

    static create(raw) {
        return new TimetableRecord(raw || {});
    }

    static validate(obj) {
        const errors = [];
        if (!obj.day)         errors.push('day is required');
        if (!obj.subjectCode) errors.push('subjectCode is required');
        return { valid: errors.length === 0, errors };
    }

    toJSON() {
        return {
            day:         this.day,
            period:      this.period,
            time:        this.time,
            subjectCode: this.subjectCode,
            subjectName: this.subjectName,
            room:        this.room,
            section:     this.section,
            facultyName: this.facultyName
        };
    }
}

// ─── FeeRecord ────────────────────────────────────────────────────────────────

class FeeRecord {
    constructor(data) {
        this.feeType       = safeStr(data.feeType || data.title);
        this.amount        = safeFloat(String(data.amount || '0').replace(/[₹,]/g, ''));
        this.paidAmount    = safeFloat(String(data.paidAmount || data.paid || '0').replace(/[₹,]/g, ''));
        this.dueAmount     = safeFloat(String(data.dueAmount || data.due || '0').replace(/[₹,]/g, ''));
        this.dueDate       = safeStr(data.dueDate || data.date, '--');
        this.paymentStatus = safeStr(data.paymentStatus || data.status,
            this.dueAmount > 0 ? 'Due' : 'Paid');
        this.ref           = safeStr(data.ref, '--');
        this.semester      = safeStr(data.semester);
        this.updatedAt     = safeDate(data.updatedAt) || new Date().toISOString();
    }

    /** Format amount as Indian locale currency string */
    get formattedAmount()     { return '₹' + this.amount.toLocaleString('en-IN'); }
    get formattedPaidAmount() { return '₹' + this.paidAmount.toLocaleString('en-IN'); }
    get formattedDueAmount()  { return '₹' + this.dueAmount.toLocaleString('en-IN'); }

    static create(raw) {
        return new FeeRecord(raw || {});
    }

    static validate(obj) {
        const errors = [];
        if (!obj.feeType)    errors.push('feeType is required');
        if (obj.amount < 0)  errors.push('amount must be >= 0');
        return { valid: errors.length === 0, errors };
    }

    toJSON() {
        return {
            feeType:       this.feeType,
            amount:        this.amount,
            paidAmount:    this.paidAmount,
            dueAmount:     this.dueAmount,
            dueDate:       this.dueDate,
            paymentStatus: this.paymentStatus,
            ref:           this.ref,
            semester:      this.semester,
            updatedAt:     this.updatedAt
        };
    }
}

// ─── TransactionRecord ────────────────────────────────────────────────────────

class TransactionRecord {
    constructor(data) {
        this.title  = safeStr(data.title || data.feeType);
        this.amount = safeStr(data.amount, '--');
        this.paid   = safeStr(data.paid, '--');
        this.due    = safeStr(data.due, '--');
        this.ref    = safeStr(data.ref, '--');
        this.date   = safeStr(data.date || data.dueDate, '--');
        // Derive icon from fee type name
        const lower = this.title.toLowerCase();
        this.icon   = lower.includes('hostel') ? 'hotel'
            : lower.includes('tuition') ? 'school'
            : lower.includes('crt') ? 'terminal'
            : 'receipt_long';
        this.status   = safeStr(data.status, safeFloat(this.due.replace(/[₹,]/g, '')) > 0 ? 'Due' : 'Paid');
        this.isRefund = data.isRefund === true;
    }

    static create(raw) {
        return new TransactionRecord(raw || {});
    }

    static validate(obj) {
        const errors = [];
        if (!obj.title) errors.push('title is required');
        return { valid: errors.length === 0, errors };
    }

    toJSON() {
        return {
            title:    this.title,
            amount:   this.amount,
            paid:     this.paid,
            due:      this.due,
            ref:      this.ref,
            date:     this.date,
            icon:     this.icon,
            status:   this.status,
            isRefund: this.isRefund
        };
    }
}

// ─── NotificationRecord ───────────────────────────────────────────────────────

class NotificationRecord {
    constructor(data) {
        this.id      = safeStr(data.id);
        this.title   = safeStr(data.title);
        this.message = safeStr(data.message);
        this.date    = safeStr(data.date, new Date().toLocaleDateString('en-IN'));
        this.isRead  = data.isRead === true;
        this.type    = safeStr(data.type, 'general');
    }

    static create(raw) {
        return new NotificationRecord(raw || {});
    }

    static validate(obj) {
        const errors = [];
        if (!obj.title)   errors.push('title is required');
        if (!obj.message) errors.push('message is required');
        return { valid: errors.length === 0, errors };
    }

    toJSON() {
        return {
            id:      this.id,
            title:   this.title,
            message: this.message,
            date:    this.date,
            isRead:  this.isRead,
            type:    this.type
        };
    }
}

// ─── AssignmentRecord ─────────────────────────────────────────────────────────

class AssignmentRecord {
    constructor(data) {
        this.title   = safeStr(data.title);
        this.subject = safeStr(data.subject, '--');
        this.status  = safeStr(data.status, 'Pending');
        this.date    = safeStr(data.date, '--');
        // Derive icon and color from status
        const s = this.status.toLowerCase();
        this.icon  = s === 'submitted' ? 'check_circle' : s === 'urgent' ? 'warning' : 'pending';
        this.color = s === 'submitted' ? 'secondary' : s === 'urgent' ? 'tertiary' : 'on-surface-variant';
    }

    static create(raw) {
        return new AssignmentRecord(raw || {});
    }

    static validate(obj) {
        const errors = [];
        if (!obj.title) errors.push('title is required');
        return { valid: errors.length === 0, errors };
    }

    toJSON() {
        return {
            title:   this.title,
            subject: this.subject,
            status:  this.status,
            date:    this.date,
            icon:    this.icon,
            color:   this.color
        };
    }
}

// ─── ExamRecord ───────────────────────────────────────────────────────────────

class ExamRecord {
    constructor(data) {
        this.subjectCode = safeStr(data.subjectCode || data.code).toUpperCase();
        this.subjectName = safeStr(data.subjectName || data.subjectCode);
        this.date        = safeStr(data.date, '--');
        this.time        = safeStr(data.time, '--');
        this.type        = safeStr(data.type, 'Regular Semester Exams');
        this.hall        = safeStr(data.hall, 'TBA');
        this.seatNumber  = safeStr(data.seatNumber, 'TBA');
        this.status      = safeStr(data.status, 'Scheduled');
    }

    static create(raw) {
        return new ExamRecord(raw || {});
    }

    static validate(obj) {
        const errors = [];
        if (!obj.subjectCode) errors.push('subjectCode is required');
        return { valid: errors.length === 0, errors };
    }

    toJSON() {
        return {
            subjectCode: this.subjectCode,
            subjectName: this.subjectName,
            date:        this.date,
            time:        this.time,
            type:        this.type,
            hall:        this.hall,
            seatNumber:  this.seatNumber,
            status:      this.status
        };
    }
}

// ─── Composite Result Types ───────────────────────────────────────────────────

/**
 * Result from getAttendance() / sync attendance module.
 */
class AttendanceResult {
    constructor({ records = [], overallPercentage = '--' } = {}) {
        this.records           = records.map(r => r instanceof AttendanceRecord ? r : AttendanceRecord.create(r));
        this.overallPercentage = overallPercentage;
    }
    toJSON() {
        return {
            records:           this.records.map(r => r.toJSON()),
            overallPercentage: this.overallPercentage
        };
    }
}

/**
 * Result from getMarks() / sync marks module.
 */
class MarksResult {
    constructor({ subjects = [], cgpa = '--', sgpa = '--', percentage = '--' } = {}) {
        this.subjects   = subjects.map(s => s instanceof MarkRecord ? s : MarkRecord.create(s));
        this.cgpa       = safeStr(cgpa, '--');
        this.sgpa       = safeStr(sgpa, '--');
        this.percentage = safeStr(percentage, '--');
    }
    toJSON() {
        return {
            subjects:   this.subjects.map(s => s.toJSON()),
            cgpa:       this.cgpa,
            sgpa:       this.sgpa,
            percentage: this.percentage
        };
    }
}

/**
 * Result from getFees() / sync fees module.
 */
class FeeResult {
    constructor({ transactions = [], totalAmount = '--', paidAmount = '--', dueAmount = '--', paidProgress = 0 } = {}) {
        this.transactions = transactions.map(t => t instanceof TransactionRecord ? t : TransactionRecord.create(t));
        this.totalAmount  = totalAmount;
        this.paidAmount   = paidAmount;
        this.dueAmount    = dueAmount;
        this.totalDue     = dueAmount;
        this.paidProgress = paidProgress;
    }
    toJSON() {
        return {
            transactions: this.transactions.map(t => t.toJSON()),
            totalAmount:  this.totalAmount,
            paidAmount:   this.paidAmount,
            dueAmount:    this.dueAmount,
            totalDue:     this.totalDue,
            paidProgress: this.paidProgress
        };
    }
}

/**
 * Result from getAssignments() / sync assignments module.
 */
class AssignmentResult {
    constructor({ list = [], activeCount = 0 } = {}) {
        this.list        = list.map(a => a instanceof AssignmentRecord ? a : AssignmentRecord.create(a));
        this.activeCount = activeCount || this.list.filter(a => a.status.toLowerCase() !== 'submitted').length;
    }
    toJSON() {
        return {
            list:        this.list.map(a => a.toJSON()),
            activeCount: this.activeCount
        };
    }
}

/**
 * Result from getExams() / sync exams module.
 */
class ExamResult {
    constructor({ schedules = [], semester = '', examName = '', academicYear = '' } = {}) {
        this.schedules    = schedules.map(e => e instanceof ExamRecord ? e : ExamRecord.create(e));
        this.semester     = semester;
        this.examName     = examName;
        this.academicYear = academicYear;
    }
    toJSON() {
        return {
            schedules:    this.schedules.map(e => e.toJSON()),
            semester:     this.semester,
            examName:     this.examName,
            academicYear: this.academicYear
        };
    }
}

/**
 * Top-level sync result returned by syncStudent() and syncIncremental().
 */
class SyncResult {
    constructor({
        profile       = null,
        marks         = null,
        attendance    = null,
        fees          = null,
        assignments   = null,
        notifications = [],
        timetable     = [],
        syncType      = 'full',
        provider      = 'unknown',
        syncedAt      = new Date().toISOString()
    } = {}) {
        this.profile       = profile instanceof ProfileRecord ? profile : (profile ? ProfileRecord.create(profile) : null);
        this.marks         = marks instanceof MarksResult ? marks : (marks ? new MarksResult(marks) : null);
        this.attendance    = attendance instanceof AttendanceResult ? attendance : (attendance ? new AttendanceResult(attendance) : null);
        this.fees          = fees instanceof FeeResult ? fees : (fees ? new FeeResult(fees) : null);
        this.assignments   = assignments instanceof AssignmentResult ? assignments : (assignments ? new AssignmentResult(assignments) : null);
        this.notifications = (notifications || []).map(n => n instanceof NotificationRecord ? n : NotificationRecord.create(n));
        this.timetable     = (timetable || []).map(t => t instanceof TimetableRecord ? t : TimetableRecord.create(t));
        this.syncType      = syncType;
        this.provider      = provider;
        this.syncedAt      = syncedAt;
    }
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
    ProfileRecord,
    AttendanceRecord,
    MarkRecord,
    SubjectRecord,
    TimetableRecord,
    FeeRecord,
    TransactionRecord,
    NotificationRecord,
    AssignmentRecord,
    ExamRecord,
    AttendanceResult,
    MarksResult,
    FeeResult,
    AssignmentResult,
    ExamResult,
    SyncResult,
    // Utilities exposed for provider implementations
    _utils: { safeFloat, safeInt, safeStr, safeDate }
};
