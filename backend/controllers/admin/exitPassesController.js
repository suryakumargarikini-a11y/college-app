'use strict';

const crypto = require('crypto');
const prisma = require('../../services/dbService');
const logger = require('../../services/logger');
const { auditLogRepository } = require('../../repositories/index');
const qrEncryptionService = require('../../services/qrEncryptionService');
const { sendSms } = require('../../services/smsService');

function generateOTP() {
    return crypto.randomInt(100000, 1000000).toString();
}

function hashOTP(otp) {
    return crypto.createHash('sha256').update(otp + 'sitam-otp-salt').digest('hex');
}

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

// Admin/Faculty: approve a pass and generate OTP/QR token
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

            const otp = generateOTP();
            const otpHash = hashOTP(otp);
            const otpExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

            const updated = await tx.exitPass.update({
                where: { id },
                data: { 
                    status: 'APPROVED', 
                    otpHash, 
                    otpExpiry, 
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
                    message: `Your exit pass request has been approved. OTP: ${otp}. Destination: ${pass.destination}`,
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

            return { status: 200, pass: updated, otp };
        }, { maxWait: 15000, timeout: 30000 });

        if (result.error) {
            return res.status(result.status).json({ error: result.error });
        }

        // Trigger FCM outside transaction
        if (result.status === 200 && result.otp) {
            try {
                const tokens = await prisma.fcmToken.findMany({ where: { studentId: result.pass.studentId } });
                if (tokens.length > 0) {
                    const firebaseService = require('../../services/firebaseService');
                    await firebaseService.sendToTokens?.(
                        tokens.map(t => t.token),
                        'Exit Pass Approved',
                        'Your exit pass has been approved. Open the app to view your OTP.'
                    );
                }
            } catch (fcmErr) {
                logger.warn('[ExitPass] Optional FCM delivery failed:', fcmErr.message);
            }
        }

        logger.info(`[ExitPass] Approved: ${id}, student: ${result.pass.student.name}, OTP generated by ${req.admin.email}`);
        res.json({ ...result.pass, otp: result.otp, qrCode: undefined, qrTokenHash: undefined, otpHash: undefined });
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

            // Update all child passes
            const approvedList = [];
            for (const item of processedMembers) {
                const rawToken = crypto.randomBytes(32).toString('hex');
                const qrTokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
                const encryptedQr = qrEncryptionService.encrypt(rawToken);

                const otp = generateOTP();
                const otpHash = hashOTP(otp);
                const otpExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000);

                const updatedPass = await tx.exitPass.update({
                    where: { id: item.passId },
                    data: {
                        status: 'APPROVED',
                        otpHash,
                        otpExpiry,
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
                        title: 'Exit Pass Approved (Group)',
                        message: `Your group exit pass (${groupRequest.groupName}) is approved. OTP: ${otp}`,
                        type: 'exit-pass',
                        category: 'success',
                        createdAt: new Date(),
                        date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                    }
                });

                approvedList.push({ pass: updatedPass, otp });
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

// Security Guard: verify manual OTP input
// SECURITY: roll is REQUIRED. Anonymous OTP hash lookup is intentionally removed
// to prevent brute-force bypasses where otpAttempts are never incremented.
const verifyOTP = async (req, res) => {
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

// Security Guard: verify scanned QR token
const verifyQrToken = async (req, res) => {
    try {
        const { token } = req.body || {};
        if (!token) return res.status(400).json({ error: 'QR token is required' });

        const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
        const pass = await prisma.exitPass.findFirst({
            where: { qrTokenHash: tokenHash },
            include: { student: { select: { id: true, name: true, roll: true, phone: true, branch: true, year: true, section: true, photoUrl: true } } }
        });

        if (!pass) {
            return res.status(400).json({ valid: false, error: 'Invalid QR Token' });
        }

        // Check expiration
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
            adminRemark: pass.adminRemark,
            exitConfirmedAt: pass.exitConfirmedAt
        });
    } catch (err) {
        logger.error('[ExitPass] verifyQrToken error:', err);
        res.status(500).json({ error: 'QR verification failed' });
    }
};

// Security Guard: mark exit pass as USED / EXITED (idempotent status checks)
const markUsed = async (req, res) => {
    try {
        const { id } = req.params;
        const pass = await prisma.exitPass.findUnique({
            where: { id },
            include: { student: true }
        });

        if (!pass) return res.status(404).json({ error: 'Exit pass not found' });
        
        // Handle idempotency
        if (pass.status === 'USED' || pass.status === 'EXITED') {
            return res.json({ success: true, pass });
        }

        if (pass.status !== 'APPROVED') {
            return res.status(400).json({ error: `Cannot mark pass as used. Current status is ${pass.status}` });
        }

        if (pass.otpExpiry && new Date() > pass.otpExpiry) {
            await prisma.exitPass.update({ where: { id: pass.id }, data: { status: 'EXPIRED' } });
            return res.status(400).json({ error: 'OTP has expired' });
        }

        const updated = await prisma.exitPass.update({
            where: { id },
            data: { 
                status: 'USED', 
                verifiedAt: new Date(),
                verifiedBy: req.admin.email
            }
        });

        await auditLogRepository.log(
            pass.studentId,
            'OTP_VERIFIED',
            `Exit pass for student ${pass.student.name} (${pass.student.roll}) marked USED by guard ${req.admin.email}`,
            req.admin.id,
            'INFO'
        );

        logger.info(`[ExitPass] Pass ${id} marked USED by guard ${req.admin.email}`);
        res.json({ success: true, pass: updated });
    } catch (err) {
        logger.error('[ExitPass] Mark used error:', err);
        res.status(500).json({ error: 'Failed to mark exit pass as used' });
    }
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
const confirmExit = async (req, res) => {
    try {
        const { id } = req.params;
        const { gate, verificationMethod } = req.body || {};

        const result = await runSerializableTransaction(async (tx) => {
            const pass = await tx.exitPass.findUnique({
                where: { id },
                include: { student: true }
            });

            if (!pass) return { status: 404, error: 'Exit pass not found' };

            // Idempotent: first scan EXITED, second scan ALREADY_USED
            if (pass.status === 'EXITED') {
                return { status: 200, success: false, state: 'ALREADY_USED', error: 'This pass has already been used to exit.' };
            }

            if (pass.status !== 'APPROVED') {
                return { status: 400, success: false, state: pass.status, error: `Cannot confirm exit. Pass is in ${pass.status} state.` };
            }

            if (pass.otpExpiry && new Date() > pass.otpExpiry) {
                await tx.exitPass.update({ where: { id }, data: { status: 'EXPIRED' } });
                return { status: 400, success: false, state: 'EXPIRED', error: 'Exit pass has expired.' };
            }

            const updated = await tx.exitPass.update({
                where: { id },
                data: {
                    status: 'EXITED',
                    exitConfirmedAt: new Date(),
                    exitConfirmedBy: req.admin.email,
                    exitGate: gate || 'MAIN_GATE',
                    verificationMethod: verificationMethod || 'QR_SCAN'
                },
                include: { student: true }
            });

            await tx.auditLog.create({
                data: {
                    studentId: pass.studentId,
                    adminId: req.admin.id,
                    action: 'EXIT_PASS_CONFIRMED',
                    details: `Exit confirmed for student ${pass.student.name} (${pass.student.roll}) via ${verificationMethod || 'QR_SCAN'}`,
                    severity: 'INFO',
                    timestamp: new Date()
                }
            });

            return { status: 200, success: true, state: 'EXITED', pass: updated };
        });

        if (result.error) {
            return res.status(result.status).json({ error: result.error });
        }

        // Trigger Parent SMS & notifications asynchronously
        if (result.success && result.state === 'EXITED') {
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
                        'Campus Exit Confirmed',
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
        if (!reason || !destination || !exitTime || !returnTime || !emergencyContact) {
            return res.status(400).json({ error: 'Reason, destination, exit time, return time, and emergency contact are required' });
        }

        const exitDate = new Date(exitTime);
        const returnDate = new Date(returnTime);
        if (isNaN(exitDate.getTime()) || isNaN(returnDate.getTime())) {
            return res.status(400).json({ error: 'Invalid exit or return date/time format' });
        }
        if (exitDate <= new Date()) {
            return res.status(400).json({ error: 'Exit time must be in the future' });
        }
        if (returnDate <= exitDate) {
            return res.status(400).json({ error: 'Return time must be later than the exit time' });
        }

        // CONCURRENCY FIX: Wrap duplicate-check + create in a SERIALIZABLE transaction.
        // Without this, concurrent requests from the same student can all pass the
        // findFirst check before any create runs, producing multiple PENDING passes.
        const pass = await prisma.$transaction(async (tx) => {
            // Prevent duplicate pending requests (individual)
            const existing = await tx.exitPass.findFirst({
                where: { studentId, status: 'PENDING' }
            });
            if (existing) {
                const err = new Error('DUPLICATE_PENDING');
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
                    returnTime: returnDate,
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
        if (!groupName || !reason || !destination || !exitTime || !returnTime || !Array.isArray(members) || members.length === 0) {
            return res.status(400).json({ error: 'Group name, reason, destination, exit time, return time, and members list are required' });
        }

        const exitDate = new Date(exitTime);
        const returnDate = new Date(returnTime);
        if (isNaN(exitDate.getTime()) || isNaN(returnDate.getTime())) {
            return res.status(400).json({ error: 'Invalid exit or return date/time format' });
        }
        if (exitDate <= new Date()) {
            return res.status(400).json({ error: 'Exit time must be in the future' });
        }
        if (returnDate <= exitDate) {
            return res.status(400).json({ error: 'Return time must be later than the exit time' });
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

        if (pass.otpExpiry && new Date() > pass.otpExpiry) {
            return res.status(400).json({ error: 'Exit pass has expired' });
        }

        if (pass.exitConfirmedAt) {
            return res.status(400).json({ error: 'Exit has already been confirmed' });
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
