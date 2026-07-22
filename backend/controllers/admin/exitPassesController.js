'use strict';

const crypto = require('crypto');
const prisma = require('../../services/dbService');
const logger = require('../../services/logger');
const { auditLogRepository } = require('../../repositories/index');
const qrEncryptionService = require('../../services/qrEncryptionService');
const { sendSms } = require('../../services/smsService');

// OTP functions removed — QR-only gate verification

// Student: helper to find authenticated student ID
const getAuthenticatedStudent = async (req) => {
    let studentId = req.session?.studentId;
    if (!studentId && req.session?.userId) {
        const student = await prisma.student.findUnique({ where: { userId: req.session.userId } });
        studentId = student?.id;
    }
    return studentId;
};

// Check current semester/academic year quota of a student
const checkSemesterQuota = async (tx, studentId) => {
    const student = await tx.student.findUnique({
        where: { id: studentId },
        select: { semester: true, academicYear: true }
    });
    if (!student) {
        throw new Error(`Student ${studentId} not found`);
    }

    const currentYear = student.academicYear || '';
    const currentSem = student.semester || '';

    // Count passes in APPROVED, USED, EXITED, RETURNED, EXPIRED
    const count = await tx.exitPass.count({
        where: {
            studentId,
            academicYear: currentYear,
            semester: currentSem,
            status: { in: ['APPROVED', 'USED', 'EXITED', 'RETURNED', 'EXPIRED'] }
        }
    });

    return {
        count,
        academicYear: currentYear,
        semester: currentSem,
        eligible: count < 10
    };
};

// Admin/Faculty: list all exit passes with optional status and search filters
const getAll = async (req, res) => {
    try {
        const { status, search } = req.query;
        const where = {};
        
        if (status && status !== 'ALL') {
            where.status = status;
        }

        if (search) {
            const cleanSearch = search.trim();
            where.OR = [
                { student: { name: { contains: cleanSearch, mode: 'insensitive' } } },
                { student: { roll: { contains: cleanSearch, mode: 'insensitive' } } },
                { student: { userId: { contains: cleanSearch, mode: 'insensitive' } } },
                { destination: { contains: cleanSearch, mode: 'insensitive' } }
            ];
        }

        const passes = await prisma.exitPass.findMany({
            where,
            include: { 
                student: { 
                    select: { 
                        id: true, 
                        name: true, 
                        roll: true, 
                        phone: true, 
                        branch: true, 
                        year: true, 
                        section: true,
                        photoUrl: true
                    } 
                },
                groupRequest: true
            },
            orderBy: { createdAt: 'desc' }
        });

        // Hide sensitive encrypted fields in listings
        const sanitized = passes.map(p => {
            const { qrCode, qrTokenHash, otpHash, ...rest } = p;
            return rest;
        });

        res.json(sanitized);
    } catch (err) { 
        logger.error('[ExitPass] getAll error:', err);
        res.status(500).json({ error: 'Failed to fetch exit passes' }); 
    }
};

// Admin/Faculty: approve a pass and generate QR token
const approve = async (req, res) => {
    try {
        const { id } = req.params;
        const { adminRemark } = req.body || {};

        const result = await prisma.$transaction(async (tx) => {
            const pass = await tx.exitPass.findUnique({ where: { id }, include: { student: true } });
            if (!pass) return { status: 404, error: 'Exit pass not found' };

            // Idempotency: if already approved, return success
            if (pass.status !== 'PENDING') {
                if (pass.status === 'APPROVED') {
                    return { status: 200, pass };
                }
                return { status: 409, error: `Conflict: Exit pass is in ${pass.status} state` };
            }

            // Quota check
            const quota = await checkSemesterQuota(tx, pass.studentId);
            if (!quota.eligible) {
                return { status: 400, error: 'Student has exhausted their semester exit pass quota (max 10 approved passes).' };
            }

            const rawToken = crypto.randomBytes(32).toString('hex');
            const qrTokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
            const encryptedQr = qrEncryptionService.encrypt(rawToken);

            const updated = await tx.exitPass.update({
                where: { id },
                data: { 
                    status: 'APPROVED', 
                    approvedAt: new Date(),
                    approvedBy: req.admin.email,
                    adminRemark: adminRemark || null,
                    academicYear: quota.academicYear,
                    semester: quota.semester,
                    qrTokenHash,
                    qrCode: encryptedQr
                },
                include: { student: true }
            });

            // Create personal notification
            await tx.notification.create({
                data: {
                    studentId: pass.studentId,
                    title: 'Exit Pass Approved',
                    message: `Your exit pass for ${pass.destination} has been approved. Show the QR code to Security at the gate.`,
                    type: 'exit-pass',
                    category: 'success',
                    createdAt: new Date(),
                    date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                }
            });

            // Log to AuditLogs
            await tx.auditLog.create({
                data: {
                    studentId: pass.studentId,
                    adminId: req.admin.id,
                    action: 'EXIT_PASS_APPROVED',
                    details: `Exit pass for student ${pass.student.name} (${pass.student.roll}) approved by ${req.admin.email}`,
                    severity: 'INFO',
                    timestamp: new Date()
                }
            });

            return { status: 200, pass: updated };
        }, { maxWait: 15000, timeout: 30000 });

        if (result.error) {
            return res.status(result.status).json({ error: result.error });
        }

        // Trigger FCM outside transaction
        if (result.status === 200) {
            try {
                const tokens = await prisma.fcmToken.findMany({ where: { studentId: result.pass.studentId } });
                if (tokens.length > 0) {
                    const firebaseService = require('../../services/firebaseService');
                    await firebaseService.sendToTokens?.(
                        tokens.map(t => t.token),
                        'Exit Pass Approved ✓',
                        `Your exit pass has been approved. Open the app to view your QR code.`
                    );
                }
            } catch (fcmErr) {
                logger.warn('[ExitPass] Optional FCM delivery failed:', fcmErr.message);
            }
        }

        logger.info(`[ExitPass] Approved: ${id}, student: ${result.pass.student.name}, by ${req.admin.email}`);
        res.json({ ...result.pass, qrCode: undefined, qrTokenHash: undefined, otpHash: undefined });
    } catch (err) {
        logger.error('[ExitPass] Approve error:', err);
        res.status(500).json({ error: 'Failed to approve exit pass' });
    }
};

// Admin/Faculty: reject a pass with optional reason/remarks
const reject = async (req, res) => {
    try {
        const { id } = req.params;
        const { reason, adminRemark } = req.body || {};
        const remark = adminRemark || reason || 'Rejected by admin';

        const result = await prisma.$transaction(async (tx) => {
            const pass = await tx.exitPass.findUnique({ where: { id }, include: { student: true } });
            if (!pass) return { status: 404, error: 'Exit pass not found' };

            if (pass.status !== 'PENDING') {
                if (pass.status === 'REJECTED') {
                    return { status: 200, pass };
                }
                return { status: 409, error: `Conflict: Exit pass is in ${pass.status} state` };
            }

            const updated = await tx.exitPass.update({
                where: { id },
                data: { 
                    status: 'REJECTED', 
                    rejectionNote: remark,
                    adminRemark: remark
                },
                include: { student: true }
            });

            // Create personal notification
            await tx.notification.create({
                data: {
                    studentId: pass.studentId,
                    title: 'Exit Pass Rejected',
                    message: `Your exit pass request was rejected. Reason: ${remark}`,
                    type: 'exit-pass',
                    category: 'alert',
                    createdAt: new Date(),
                    date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                }
            });

            return { status: 200, pass: updated };
        }, { maxWait: 15000, timeout: 30000 });

        if (result.error) {
            return res.status(result.status).json({ error: result.error });
        }

        // Trigger FCM outside transaction (mirrors the approve path)
        try {
            const tokens = await prisma.fcmToken.findMany({ where: { studentId: result.pass.studentId } });
            if (tokens.length > 0) {
                const firebaseService = require('../../services/firebaseService');
                await firebaseService.sendToTokens?.(
                    tokens.map(t => t.token),
                    'Exit Pass Rejected',
                    `Your exit pass request was rejected. Reason: ${result.pass.rejectionNote || 'See app for details.'}`
                );
            }
        } catch (fcmErr) {
            logger.warn('[ExitPass] Optional FCM (reject) delivery failed:', fcmErr.message);
        }

        res.json(result.pass);
    } catch (err) { 
        logger.error('[ExitPass] Reject error:', err);
        res.status(500).json({ error: 'Failed to reject exit pass' }); 
    }
};

// Admin/Faculty: approve a group exit pass request atomically
const approveGroup = async (req, res) => {
    try {
        const { id } = req.params;
        const { adminRemark } = req.body || {};

        const result = await prisma.$transaction(async (tx) => {
            const groupRequest = await tx.groupExitPassRequest.findUnique({
                where: { id },
                include: { passes: { include: { student: true } } }
            });

            if (!groupRequest) {
                return { status: 404, error: 'Group request not found' };
            }

            if (groupRequest.status !== 'PENDING') {
                if (groupRequest.status === 'APPROVED') {
                    return { status: 200, groupRequest };
                }
                return { status: 409, error: `Group request is in ${groupRequest.status} state` };
            }

            // Verify quota and existence for all group members atomically
            const ineligible = [];
            const processedMembers = [];

            for (const pass of groupRequest.passes) {
                const quota = await checkSemesterQuota(tx, pass.studentId);
                if (!quota.eligible) {
                    ineligible.push(`${pass.student.name} (${pass.student.roll}) - Quota Exceeded`);
                }
                processedMembers.push({
                    passId: pass.id,
                    studentId: pass.studentId,
                    academicYear: quota.academicYear,
                    semester: quota.semester
                });
            }

            if (ineligible.length > 0) {
                return {
                    status: 400,
                    error: `Atomic group approval failed. The following members are ineligible: ${ineligible.join(', ')}`
                };
            }

            // Update group status
            const updatedGroup = await tx.groupExitPassRequest.update({
                where: { id },
                data: {
                    status: 'APPROVED',
                    approvedAt: new Date(),
                    approvedBy: req.admin.email
                }
            });

            // Update all child passes — each gets its own QR token (per-student model)
            const approvedList = [];
            for (const item of processedMembers) {
                const rawToken = crypto.randomBytes(32).toString('hex');
                const qrTokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
                const encryptedQr = qrEncryptionService.encrypt(rawToken);

                const updatedPass = await tx.exitPass.update({
                    where: { id: item.passId },
                    data: {
                        status: 'APPROVED',
                        approvedAt: new Date(),
                        approvedBy: req.admin.email,
                        adminRemark: adminRemark || null,
                        academicYear: item.academicYear,
                        semester: item.semester,
                        qrTokenHash,
                        qrCode: encryptedQr
                    },
                    include: { student: true }
                });

                await tx.notification.create({
                    data: {
                        studentId: item.studentId,
                        title: 'Group Exit Pass Approved ✓',
                        message: `Your group exit pass (${groupRequest.groupName}) has been approved. Show your QR code to Security at the gate.`,
                        type: 'exit-pass',
                        category: 'success',
                        createdAt: new Date(),
                        date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                    }
                });

                approvedList.push({ pass: updatedPass });
            }

            return { status: 200, groupRequest: updatedGroup, approvedList };
        }, { maxWait: 15000, timeout: 30000 });

        if (result.error) {
            return res.status(result.status).json({ error: result.error });
        }

        // Trigger FCM outside transaction
        if (result.status === 200 && result.approvedList) {
            for (const item of result.approvedList) {
                try {
                    const tokens = await prisma.fcmToken.findMany({ where: { studentId: item.pass.studentId } });
                    if (tokens.length > 0) {
                        const firebaseService = require('../../services/firebaseService');
                        await firebaseService.sendToTokens?.(
                            tokens.map(t => t.token),
                            'Exit Pass Approved',
                            `Your group exit pass has been approved. Open the app to view details.`
                        );
                    }
                } catch (fcmErr) {
                    logger.warn('[ExitPass] FCM notification skipped:', fcmErr.message);
                }
            }
        }

        res.json({ success: true, groupRequest: result.groupRequest });
    } catch (err) {
        logger.error('[ExitPass] approveGroup error:', err);
        res.status(500).json({ error: 'Failed to approve group exit pass' });
    }
};

// Admin/Faculty: reject a group exit pass request
const rejectGroup = async (req, res) => {
    try {
        const { id } = req.params;
        const { reason } = req.body || {};
        const remark = reason || 'Rejected by admin';

        const result = await prisma.$transaction(async (tx) => {
            const groupRequest = await tx.groupExitPassRequest.findUnique({
                where: { id },
                include: { passes: true }
            });

            if (!groupRequest) return { status: 404, error: 'Group request not found' };

            if (groupRequest.status !== 'PENDING') {
                if (groupRequest.status === 'REJECTED') {
                    return { status: 200, groupRequest };
                }
                return { status: 409, error: `Group request is in ${groupRequest.status} state` };
            }

            const updatedGroup = await tx.groupExitPassRequest.update({
                where: { id },
                data: {
                    status: 'REJECTED',
                    rejectionNote: remark
                }
            });

            for (const pass of groupRequest.passes) {
                await tx.exitPass.update({
                    where: { id: pass.id },
                    data: {
                        status: 'REJECTED',
                        rejectionNote: remark,
                        adminRemark: remark
                    }
                });

                await tx.notification.create({
                    data: {
                        studentId: pass.studentId,
                        title: 'Exit Pass Rejected (Group)',
                        message: `Your group exit pass request was rejected. Reason: ${remark}`,
                        type: 'exit-pass',
                        category: 'alert',
                        createdAt: new Date(),
                        date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                    }
                });
            }

            return { status: 200, groupRequest: updatedGroup };
        }, { maxWait: 15000, timeout: 30000 });

        if (result.error) {
            return res.status(result.status).json({ error: result.error });
        }

        res.json({ success: true, groupRequest: result.groupRequest });
    } catch (err) {
        logger.error('[ExitPass] rejectGroup error:', err);
        res.status(500).json({ error: 'Failed to reject group exit pass' });
    }
};

// OTP verification removed — QR-only gate verification is now the only supported flow.
// This stub returns 410 Gone so any stale client integrations surface clearly.
const verifyOTP = async (req, res) => {
    return res.status(410).json({
        error: 'OTP-based verification has been removed. Please use the QR code scanner (POST /verify-qr).',
        code: 'OTP_REMOVED'
    });
};

// (DEAD CODE — kept as reference for the shape of the old function)
const _verifyOTP_legacy_REMOVED = async (req, res) => {
    try {
        const { otp, roll } = req.body || {};
        if (!otp) return res.status(400).json({ error: 'OTP is required' });

        // SECURITY FIX: roll is now mandatory. Anonymous OTP hash lookup
        // allowed unlimited brute-force because otpAttempts was only incremented
        // on the roll-based path. This path is permanently removed.
        if (!roll) {
            return res.status(400).json({ valid: false, error: 'Student roll number is required for OTP verification' });
        }

        const student = await prisma.student.findFirst({
            where: {
                OR: [
                    { roll: roll.trim().toUpperCase() },
                    { userId: roll.trim().toUpperCase() }
                ]
            }
        });
        if (!student) {
            return res.status(400).json({ valid: false, error: 'Student not found' });
        }

        const pass = await prisma.exitPass.findFirst({
            where: { studentId: student.id, status: { in: ['APPROVED', 'UNDER_REVIEW'] } },
            include: { student: { select: { id: true, name: true, roll: true, phone: true, branch: true, year: true, section: true, photoUrl: true } } }
        });

        if (!pass) {
            return res.status(400).json({ valid: false, error: 'No active approved exit pass found for this student' });
        }

        if (pass.status === 'UNDER_REVIEW' || pass.otpAttempts >= 3) {
            return res.status(400).json({ valid: false, error: 'This pass has been locked due to too many failed OTP attempts.' });
        }

        const otpHash = hashOTP(otp);
        if (pass.otpHash !== otpHash) {
            // SECURITY: Always increment attempts, even when pass is found via roll.
            // Use atomic update with optimistic concurrency — re-read after update.
            const updated = await prisma.exitPass.update({
                where: { id: pass.id },
                data: { otpAttempts: { increment: 1 } },
                select: { otpAttempts: true }
            });
            const updatedAttempts = updated.otpAttempts;

            if (updatedAttempts >= 3) {
                await prisma.exitPass.update({
                    where: { id: pass.id },
                    data: { status: 'UNDER_REVIEW', identityMismatchReason: 'Locked: Too many failed OTP attempts' }
                });
                return res.status(400).json({ valid: false, error: 'Too many incorrect OTP attempts. The exit pass has been locked and placed under review.' });
            }

            return res.status(400).json({ valid: false, error: `Invalid OTP. ${3 - updatedAttempts} attempts remaining.` });
        }

        // Check if expired
        if (pass.status === 'APPROVED' && pass.otpExpiry && new Date() > pass.otpExpiry) {
            await prisma.exitPass.update({ where: { id: pass.id }, data: { status: 'EXPIRED' } });
            pass.status = 'EXPIRED';
        }

        res.json({
            valid: true,
            id: pass.id,
            status: pass.status,
            student: pass.student,
            destination: pass.destination,
            reason: pass.reason,
            requestedDate: pass.requestedDate,
            approvedBy: pass.approvedBy,
            otpExpiry: pass.otpExpiry,
            exitTime: pass.exitTime,
            returnTime: pass.returnTime,
            emergencyContact: pass.emergencyContact,
            remarks: pass.remarks,
            adminRemark: pass.adminRemark
        });
    } catch (err) { 
        logger.error('[ExitPass] verifyOTP error:', err);
        res.status(500).json({ error: 'OTP verification failed' }); 
    }
};

// Security Guard: verify scanned QR token — ATOMIC SINGLE-USE CONSUMPTION
// The first successful scan sets verifiedAt in a Serializable transaction.
// Any subsequent scan (including concurrent scans of the same token) will
// see verifiedAt already set and return ALREADY_USED.
const verifyQrToken = async (req, res) => {
    try {
        const { token } = req.body || {};
        if (!token) return res.status(400).json({ error: 'QR token is required' });

        const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

        const result = await runSerializableTransaction(async (tx) => {
            // Lock the row for update
            const pass = await tx.exitPass.findFirst({
                where: { qrTokenHash: tokenHash },
                include: {
                    student: {
                        select: { id: true, name: true, roll: true, phone: true, branch: true, year: true, section: true, photoUrl: true }
                    }
                }
            });

            if (!pass) {
                return { status: 400, valid: false, error: 'Invalid QR code. Token not recognised.' };
            }

            // Already exited — replay protection
            if (pass.status === 'EXITED') {
                return { status: 200, valid: false, alreadyUsed: true, error: 'QR ALREADY USED — This exit pass has already been verified and the student has exited.' };
            }

            // QR already consumed by a previous scan — replay protection
            if (pass.verifiedAt) {
                return { status: 200, valid: false, alreadyUsed: true, error: 'QR ALREADY USED — This QR code has already been scanned. Please confirm the exit for the student shown.' };
            }

            // Only APPROVED passes are valid at the gate
            if (pass.status !== 'APPROVED') {
                const messages = {
                    PENDING:      'This exit pass is still pending approval.',
                    REJECTED:     'This exit pass has been rejected.',
                    CANCELLED:    'This exit pass has been cancelled.',
                    EXPIRED:      'This exit pass has expired.',
                    UNDER_REVIEW: 'This exit pass is under security review. Do not permit exit.'
                };
                return { status: 400, valid: false, error: messages[pass.status] || `Pass is in ${pass.status} state.` };
            }

            // Atomically consume the QR — mark verifiedAt so second scan fails
            const consumed = await tx.exitPass.updateMany({
                where: { id: pass.id, verifiedAt: null },  // conditional: only if not yet consumed
                data: {
                    verifiedAt: new Date(),
                    verifiedBy: req.admin.email
                }
            });

            if (consumed.count === 0) {
                // Another concurrent request consumed it first
                return { status: 200, valid: false, alreadyUsed: true, error: 'QR ALREADY USED — Another scan of this QR code was processed simultaneously. Only one exit is allowed.' };
            }

            // Audit log the scan event
            await tx.auditLog.create({
                data: {
                    studentId: pass.studentId,
                    adminId: req.admin.id,
                    action: 'EXIT_PASS_QR_SCANNED',
                    details: `QR scanned for student ${pass.student.name} (${pass.student.roll}) by guard ${req.admin.email}`,
                    severity: 'INFO',
                    timestamp: new Date()
                }
            });

            return {
                status: 200,
                valid: true,
                id: pass.id,
                status: pass.status,
                student: pass.student,
                destination: pass.destination,
                reason: pass.reason,
                requestedDate: pass.requestedDate,
                approvedBy: pass.approvedBy,
                exitTime: pass.exitTime,
                emergencyContact: pass.emergencyContact,
                remarks: pass.remarks,
                adminRemark: pass.adminRemark
            };
        });

        return res.status(result.status).json(
            result.valid
                ? { valid: true, id: result.id, status: result.status, student: result.student, destination: result.destination, reason: result.reason, requestedDate: result.requestedDate, approvedBy: result.approvedBy, exitTime: result.exitTime, emergencyContact: result.emergencyContact, remarks: result.remarks, adminRemark: result.adminRemark }
                : { valid: false, alreadyUsed: result.alreadyUsed || false, error: result.error }
        );
    } catch (err) {
        logger.error('[ExitPass] verifyQrToken error:', err);
        res.status(500).json({ error: 'QR verification failed' });
    }
};

// markUsed removed — use confirmExit instead (POST /:id/confirm-exit)
const markUsed = async (req, res) => {
    return res.status(410).json({
        error: 'This endpoint has been removed. Use POST /:id/confirm-exit to complete the exit verification.',
        code: 'ENDPOINT_REMOVED'
    });
};

// Run a transaction with Serializable isolation level and automatic retry on conflicts
const runSerializableTransaction = async (fn, maxRetries = 5, delayMs = 150) => {
    let attempt = 0;
    while (true) {
        try {
            return await prisma.$transaction(fn, {
                isolationLevel: 'Serializable',
                maxWait: 10000,
                timeout: 15000
            });
        } catch (err) {
            attempt++;
            const isSerializationError = 
                err.code === 'P2034' || 
                err.message?.includes('serialization failure') || 
                err.message?.includes('deadlock') || 
                err.message?.includes('40001');

            if (isSerializationError && attempt < maxRetries) {
                logger.warn(`[DB-Concurrency] Serialization conflict detected on attempt ${attempt}. Retrying in ${delayMs}ms...`);
                await new Promise(resolve => setTimeout(resolve, delayMs));
                continue;
            }
            throw err;
        }
    }
};

// Security Guard: confirm student campus exit
// SECURITY HARDENING:
//   1. Guard-binding: only the guard who consumed the QR (verifiedBy) may confirm exit.
//      verifiedBy = req.admin.email is set atomically during QR scan (verifyQrToken).
//      Both sides derive from the signed JWT payload — tamper-proof.
//   2. Atomic APPROVED→EXITED: conditional updateMany prevents duplicate transitions
//      from concurrent confirm-exit requests. Side effects execute ONLY for count === 1.
const confirmExit = async (req, res) => {
    try {
        const { id } = req.params;
        const { gate, verificationMethod } = req.body || {};
        const guardEmail = req.admin.email;

        const result = await runSerializableTransaction(async (tx) => {
            const pass = await tx.exitPass.findUnique({
                where: { id },
                include: { student: true }
            });

            if (!pass) return { status: 404, error: 'Exit pass not found' };

            // Idempotency: already exited
            if (pass.status === 'EXITED') {
                return { status: 200, success: false, state: 'ALREADY_EXITED', error: 'This exit pass has already been confirmed. Exit was already recorded.' };
            }

            if (pass.status !== 'APPROVED') {
                return { status: 400, success: false, state: pass.status, error: `Cannot confirm exit. Pass is in ${pass.status} state.` };
            }

            // SECURITY: QR must have been atomically consumed (verifiedAt set) before exit can be confirmed.
            if (!pass.verifiedAt) {
                return { status: 400, success: false, state: 'NOT_VERIFIED', error: 'QR code must be scanned and verified before confirming exit.' };
            }

            // SECURITY: Guard-binding check.
            // Only the guard whose JWT email matches verifiedBy may call confirm-exit.
            // This prevents Guard B from confirming a QR that Guard A scanned.
            // verifiedBy was set atomically during QR consumption — both sides derive from signed JWT.
            if (!pass.verifiedBy) {
                // verifiedBy should always be set when verifiedAt is set — treat as integrity failure
                return { status: 500, success: false, state: 'INTEGRITY_ERROR', error: 'Verification binding record is missing. Contact system administrator.' };
            }
            if (pass.verifiedBy !== guardEmail) {
                logger.warn(`[ExitPass] Confirm-exit FORBIDDEN: pass ${id} was scanned by [${pass.verifiedBy}], attempted confirm by [${guardEmail}]`);
                return { status: 403, success: false, state: 'FORBIDDEN', error: 'FORBIDDEN: This exit pass was scanned by a different Security Guard. Only the guard who scanned the QR may confirm this exit.' };
            }

            // Atomic APPROVED→EXITED: conditional updateMany prevents two concurrent
            // confirm-exit requests both transitioning the status.
            // Only the request that sees status='APPROVED' at the time of the write wins.
            const transitioned = await tx.exitPass.updateMany({
                where: { id, status: 'APPROVED' },  // conditional: only if still APPROVED
                data: {
                    status: 'EXITED',
                    exitConfirmedAt: new Date(),
                    exitConfirmedBy: guardEmail,
                    exitGate: gate || 'MAIN_GATE',
                    verificationMethod: verificationMethod || 'QR_SCAN'
                }
            });

            if (transitioned.count === 0) {
                // Another concurrent request already transitioned the pass
                return { status: 200, success: false, state: 'ALREADY_EXITED', error: 'ALREADY_EXITED — This exit was confirmed simultaneously by another request. Exit has been recorded.' };
            }

            // Re-fetch for response payload (updateMany does not return the record)
            const updated = await tx.exitPass.findUnique({
                where: { id },
                include: { student: true }
            });

            await tx.auditLog.create({
                data: {
                    studentId: pass.studentId,
                    adminId: req.admin.id,
                    action: 'EXIT_PASS_CONFIRMED',
                    details: `Exit confirmed for student ${pass.student.name} (${pass.student.roll}) via ${verificationMethod || 'QR_SCAN'} by guard ${guardEmail}`,
                    severity: 'INFO',
                    timestamp: new Date()
                }
            });

            return { status: 200, success: true, state: 'EXITED', transitioned: true, pass: updated };
        });

        if (result.error && !result.success) {
            return res.status(result.status).json({ success: false, state: result.state, error: result.error });
        }

        // Side effects: SMS + FCM execute ONLY when this request performed the actual state transition.
        // transitioned: true is only set when updateMany.count === 1.
        // This prevents duplicate SMS/FCM if confirm-exit is called multiple times or concurrently.
        if (result.success && result.transitioned && result.state === 'EXITED') {
            const student = result.pass.student;
            const parentPhone = student.fatherMobile || student.motherMobile || student.guardianPhone || student.phone;

            if (parentPhone) {
                const message = `SITAM ERP: Your ward ${student.name} (${student.roll}) has exited campus at ${new Date(result.pass.exitConfirmedAt).toLocaleTimeString()} via ${result.pass.exitGate || 'Main Gate'}.`;
                sendSms({
                    to: parentPhone,
                    message,
                    studentId: student.id,
                    passId: result.pass.id,
                    type: 'EXIT_NOTIFICATION'
                }).catch(err => {
                    logger.error('[ExitPass] Background parent SMS failed:', err);
                });
            }

            try {
                const tokens = await prisma.fcmToken.findMany({ where: { studentId: student.id } });
                if (tokens.length > 0) {
                    const firebaseService = require('../../services/firebaseService');
                    await firebaseService.sendToTokens?.(
                        tokens.map(t => t.token),
                        'Campus Exit Confirmed ✓',
                        `Your campus exit has been recorded at ${result.pass.exitGate || 'Main Gate'}.`
                    );
                }
            } catch (fcmErr) {
                logger.warn('[ExitPass] Background FCM notice failed:', fcmErr.message);
            }
        }

        res.json({ success: result.success, state: result.state, pass: result.pass, error: result.error });
    } catch (err) {
        logger.error('[ExitPass] confirmExit error:', err);
        res.status(500).json({ error: 'Failed to confirm exit' });
    }
};

// Security Guard: reject identity/details match and suspend pass
const rejectIdentity = async (req, res) => {
    try {
        const { id } = req.params;
        const { reason } = req.body || {};
        if (!reason) return res.status(400).json({ error: 'Reason for mismatch is required' });

        const result = await runSerializableTransaction(async (tx) => {
            const pass = await tx.exitPass.findUnique({ where: { id }, include: { student: true } });
            if (!pass) return { status: 404, error: 'Exit pass not found' };

            if (pass.status !== 'APPROVED') {
                return { status: 400, error: `Cannot reject identity. Pass is in ${pass.status} state` };
            }

            const updated = await tx.exitPass.update({
                where: { id },
                data: {
                    status: 'UNDER_REVIEW',
                    identityMismatchReason: reason
                },
                include: { student: true }
            });

            await tx.auditLog.create({
                data: {
                    studentId: pass.studentId,
                    adminId: req.admin.id,
                    action: 'IDENTITY_MISMATCH_REPORTED',
                    details: `Identity mismatch reported for ${pass.student.name} (${pass.student.roll}). Reason: ${reason}`,
                    severity: 'WARNING',
                    timestamp: new Date()
                }
            });

            return { status: 200, success: true, pass: updated };
        });

        if (result.error) {
            return res.status(result.status).json({ error: result.error });
        }

        res.json({ success: true, pass: result.pass });
    } catch (err) {
        logger.error('[ExitPass] rejectIdentity error:', err);
        res.status(500).json({ error: 'Failed to report identity mismatch' });
    }
};

// Student: submit a new individual exit pass application
const apply = async (req, res) => {
    try {
        const studentId = await getAuthenticatedStudent(req);
        if (!studentId) return res.status(401).json({ error: 'Not authenticated' });

        const { reason, destination, exitTime, returnTime, emergencyContact, remarks } = req.body;
        if (!reason || !destination || !exitTime || !emergencyContact) {
            return res.status(400).json({ error: 'Reason, destination, exit time, and emergency contact are required' });
        }

        const exitDate = new Date(exitTime);
        if (isNaN(exitDate.getTime())) {
            return res.status(400).json({ error: 'Invalid exit date/time format' });
        }
        if (exitDate <= new Date()) {
            return res.status(400).json({ error: 'Exit time must be in the future' });
        }

        // returnTime is optional — validate only if provided
        let returnDate = null;
        if (returnTime) {
            returnDate = new Date(returnTime);
            if (isNaN(returnDate.getTime())) {
                return res.status(400).json({ error: 'Invalid return date/time format' });
            }
            if (returnDate <= exitDate) {
                return res.status(400).json({ error: 'Return time must be later than exit time' });
            }
        }

        // CONCURRENCY FIX: Wrap duplicate-check + create in a SERIALIZABLE transaction.
        // Without this, concurrent requests from the same student can all pass the
        // findFirst check before any create runs, producing multiple PENDING passes.
        const pass = await prisma.$transaction(async (tx) => {
            // Prevent duplicate active requests (individual PENDING or APPROVED)
            const existing = await tx.exitPass.findFirst({
                where: { studentId, status: { in: ['PENDING', 'APPROVED'] } }
            });
            if (existing) {
                const err = new Error(existing.status === 'APPROVED' ? 'ACTIVE_APPROVED' : 'DUPLICATE_PENDING');
                err.statusCode = 400;
                throw err;
            }

            // Check if student is already in a pending group request
            const existingGroup = await tx.exitPass.findFirst({
                where: {
                    studentId,
                    groupRequest: { status: 'PENDING' }
                }
            });
            if (existingGroup) {
                const err = new Error('DUPLICATE_GROUP');
                err.statusCode = 400;
                throw err;
            }

            return tx.exitPass.create({
                data: {
                    studentId,
                    reason,
                    destination,
                    exitTime: exitDate,
                    returnTime: returnDate,  // null if not provided
                    emergencyContact,
                    remarks: remarks || null,
                    requestedDate: exitDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
                    status: 'PENDING'
                }
            });
        }, {
            isolationLevel: 'Serializable',
            maxWait: 10000,
            timeout: 15000
        });

        res.status(201).json({ success: true, ...pass });
    } catch (err) {
        if (err.message === 'ACTIVE_APPROVED') {
            return res.status(400).json({ error: 'You already have an active approved exit pass. Please use or cancel it before requesting a new one.' });
        }
        if (err.message === 'DUPLICATE_PENDING') {
            return res.status(400).json({ error: 'You already have a pending exit pass request.' });
        }
        if (err.message === 'DUPLICATE_GROUP') {
            return res.status(400).json({ error: 'You are already part of a pending group exit pass request.' });
        }
        logger.error('[ExitPass] apply error:', err);
        res.status(500).json({ error: 'Failed to submit exit pass' });
    }
};

// Student: submit a new group exit pass application
const applyGroup = async (req, res) => {
    try {
        const studentId = await getAuthenticatedStudent(req);
        if (!studentId) return res.status(401).json({ error: 'Not authenticated' });

        const { groupName, reason, destination, exitTime, returnTime, members } = req.body;
        if (!groupName || !reason || !destination || !exitTime || !Array.isArray(members) || members.length === 0) {
            return res.status(400).json({ error: 'Group name, reason, destination, exit time, and members list are required' });
        }

        const exitDate = new Date(exitTime);
        if (isNaN(exitDate.getTime())) {
            return res.status(400).json({ error: 'Invalid exit date/time format' });
        }
        if (exitDate <= new Date()) {
            return res.status(400).json({ error: 'Exit time must be in the future' });
        }

        // returnTime is optional — validate only if provided
        let returnDate = null;
        if (returnTime) {
            returnDate = new Date(returnTime);
            if (isNaN(returnDate.getTime())) {
                return res.status(400).json({ error: 'Invalid return date/time format' });
            }
            if (returnDate <= exitDate) {
                return res.status(400).json({ error: 'Return time must be later than exit time' });
            }
        }

        const leader = await prisma.student.findUnique({ where: { id: studentId } });
        if (!leader) return res.status(404).json({ error: 'Leader student record not found' });

        // Resolve member inputs (ID or Roll number)
        const uniqueInputs = Array.from(new Set(members.map(m => m.trim().toUpperCase())));
        const students = await prisma.student.findMany({
            where: {
                OR: [
                    { id: { in: uniqueInputs } },
                    { roll: { in: uniqueInputs } },
                    { userId: { in: uniqueInputs } }
                ]
            }
        });

        const foundIdentifiers = new Set();
        students.forEach(s => {
            foundIdentifiers.add(s.id.toUpperCase());
            foundIdentifiers.add(s.roll.toUpperCase());
            foundIdentifiers.add(s.userId.toUpperCase());
        });

        const missing = uniqueInputs.filter(input => !foundIdentifiers.has(input));
        if (missing.length > 0) {
            return res.status(400).json({ error: `The following members could not be found: ${missing.join(', ')}` });
        }

        // Include leader if not explicitly added
        if (!students.some(s => s.id === leader.id)) {
            students.push(leader);
        }

        // Validate duplicates and pending statuses
        for (const student of students) {
            const pendingIndividual = await prisma.exitPass.findFirst({
                where: { studentId: student.id, status: 'PENDING' }
            });
            if (pendingIndividual) {
                return res.status(400).json({ error: `Student ${student.name} (${student.roll}) already has a pending individual request.` });
            }
            
            const pendingGroup = await prisma.exitPass.findFirst({
                where: {
                    studentId: student.id,
                    groupRequest: {
                        status: 'PENDING'
                    }
                }
            });
            if (pendingGroup) {
                return res.status(400).json({ error: `Student ${student.name} (${student.roll}) is already part of another pending group request.` });
            }
        }

        const result = await prisma.$transaction(async (tx) => {
            const groupRequest = await tx.groupExitPassRequest.create({
                data: {
                    groupName,
                    reason,
                    destination,
                    exitTime: exitDate,
                    returnTime: returnDate,
                    leaderId: leader.id,
                    status: 'PENDING'
                }
            });

            const passes = [];
            for (const student of students) {
                const pass = await tx.exitPass.create({
                    data: {
                        studentId: student.id,
                        groupRequestId: groupRequest.id,
                        reason,
                        destination,
                        exitTime: exitDate,
                        returnTime: returnDate,
                        emergencyContact: student.emergencyContact || student.fatherMobile || student.phone,
                        remarks: `Group: ${groupName} (Leader: ${leader.name})`,
                        requestedDate: exitDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
                        status: 'PENDING'
                    }
                });
                passes.push(pass);
            }

            return { groupRequest, passes };
        });

        res.status(201).json({ success: true, ...result });
    } catch (err) {
        logger.error('[ExitPass] applyGroup error:', err);
        res.status(500).json({ error: 'Failed to submit group exit pass' });
    }
};

// Student: cancel a pending exit pass
const cancel = async (req, res) => {
    try {
        const studentId = await getAuthenticatedStudent(req);
        if (!studentId) return res.status(401).json({ error: 'Not authenticated' });

        const { id } = req.params;

        const result = await prisma.$transaction(async (tx) => {
            const pass = await tx.exitPass.findUnique({ where: { id } });
            if (!pass) return { status: 404, error: 'Exit pass not found' };
            if (pass.studentId !== studentId) return { status: 403, error: 'Unauthorized' };

            if (pass.status !== 'PENDING') {
                if (pass.status === 'CANCELLED') {
                    return { status: 200, pass };
                }
                return { status: 409, error: `Cannot cancel pass. Current status is ${pass.status}` };
            }

            const updated = await tx.exitPass.update({
                where: { id },
                data: { status: 'CANCELLED' }
            });

            return { status: 200, pass: updated };
        });

        if (result.error) {
            return res.status(result.status).json({ error: result.error });
        }

        res.json({ success: true, ...result.pass });
    } catch (err) {
        logger.error('[ExitPass] cancel error:', err);
        res.status(500).json({ error: 'Failed to cancel exit pass' });
    }
};

// Student: fetch own exit pass history
const getMyPasses = async (req, res) => {
    try {
        const studentId = await getAuthenticatedStudent(req);
        if (!studentId) return res.status(401).json({ error: 'Not authenticated' });

        const passes = await prisma.exitPass.findMany({
            where: { studentId },
            include: { groupRequest: true },
            orderBy: { createdAt: 'desc' }
        });

        // Hide raw token hashes and internal otp secrets from students
        const filtered = passes.map(p => {
            const { otpHash, qrCode, qrTokenHash, ...rest } = p;
            return rest;
        });

        res.json(filtered);
    } catch (err) { 
        logger.error('[ExitPass] getMyPasses error:', err);
        res.status(500).json({ error: 'Failed to fetch exit passes' }); 
    }
};

// Student: get decrypted QR code token for active approved pass
const getQrToken = async (req, res) => {
    try {
        const studentId = await getAuthenticatedStudent(req);
        if (!studentId) return res.status(401).json({ error: 'Not authenticated' });

        const { id } = req.params;
        const pass = await prisma.exitPass.findUnique({
            where: { id }
        });

        if (!pass) return res.status(404).json({ error: 'Exit pass not found' });
        if (pass.studentId !== studentId) {
            return res.status(403).json({ error: 'Access denied: You do not own this exit pass' });
        }

        if (pass.status !== 'APPROVED') {
            return res.status(400).json({ error: `Exit pass is in ${pass.status} state, not APPROVED` });
        }

        if (pass.exitConfirmedAt) {
            return res.status(400).json({ error: 'Exit has already been confirmed' });
        }

        // Do not return the QR token if it has already been consumed (verifiedAt set)
        // — the student's app can still display status but the raw token is no longer needed
        if (pass.verifiedAt) {
            return res.status(400).json({ error: 'QR code has already been scanned by Security. Your exit is being processed.' });
        }

        if (!pass.qrCode) {
            return res.status(400).json({ error: 'QR token not generated for this pass' });
        }

        const rawToken = qrEncryptionService.decrypt(pass.qrCode);
        res.json({ qrToken: rawToken });
    } catch (err) {
        logger.error('[ExitPass] getQrToken error:', err);
        res.status(500).json({ error: 'Failed to retrieve QR token' });
    }
};

// Student: view remaining semester quota
const getMyQuota = async (req, res) => {
    try {
        const studentId = await getAuthenticatedStudent(req);
        if (!studentId) return res.status(401).json({ error: 'Not authenticated' });

        const quotaInfo = await checkSemesterQuota(prisma, studentId);
        const remaining = Math.max(0, 10 - quotaInfo.count);

        res.json({
            count: quotaInfo.count,
            semester: quotaInfo.semester,
            academicYear: quotaInfo.academicYear,
            remaining,
            maxQuota: 10
        });
    } catch (err) {
        logger.error('[ExitPass] getMyQuota error:', err);
        res.status(500).json({ error: 'Failed to check quota' });
    }
};

// Admin: list all group exit pass requests
const getGroups = async (req, res) => {
    try {
        const { status } = req.query;
        const where = {};
        if (status && status !== 'ALL') {
            where.status = status;
        }

        const groups = await prisma.groupExitPassRequest.findMany({
            where,
            include: {
                passes: {
                    include: {
                        student: {
                            select: {
                                id: true,
                                name: true,
                                roll: true,
                                branch: true,
                                year: true,
                                section: true
                            }
                        }
                    }
                }
            },
            orderBy: { createdAt: 'desc' }
        });

        res.json(groups);
    } catch (err) {
        logger.error('[ExitPass] getGroups error:', err);
        res.status(500).json({ error: 'Failed to fetch group requests' });
    }
};

// Admin: check quota of a specific student
const getStudentQuotaForAdmin = async (req, res) => {
    try {
        const { studentId } = req.params;
        const quotaInfo = await checkSemesterQuota(prisma, studentId);
        res.json({
            count: quotaInfo.count,
            remaining: Math.max(0, 10 - quotaInfo.count),
            semester: quotaInfo.semester,
            academicYear: quotaInfo.academicYear
        });
    } catch (err) {
        logger.error('[ExitPass] getStudentQuotaForAdmin error:', err);
        res.status(500).json({ error: 'Failed to retrieve student quota' });
    }
};

module.exports = {
    getAll,
    approve,
    reject,
    approveGroup,
    rejectGroup,
    verifyOTP,
    verifyQrToken,
    markUsed,
    confirmExit,
    rejectIdentity,
    apply,
    applyGroup,
    cancel,
    getMyPasses,
    getQrToken,
    getMyQuota,
    getGroups,
    getStudentQuotaForAdmin
};
