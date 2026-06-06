const express = require('express');
const router = express.Router();
const prisma = require('../services/dbService');
const { requireAuth } = require('../middleware/auth');
const logger = require('../services/logger');

// GET /api/student/:id/attendance
router.get('/:id/attendance', requireAuth, async (req, res, next) => {
    try {
        const studentId = req.params.id;
        const student = await prisma.student.findFirst({
            where: { OR: [{ id: studentId }, { userId: studentId }] }
        });
        
        if (!student) {
            return res.status(404).json({ success: false, message: 'Student not found' });
        }

        const records = await prisma.attendanceRecord.findMany({
            where: { studentId: student.id },
            include: { subject: true }
        });

        const attendance = records.map(a => ({
            subject: a.subject.code,
            present: a.attended,
            total: a.held,
            percentage: a.percentage,
            status: a.percentage >= 75 ? 'Safe' : a.percentage >= 65 ? 'Warning' : 'Critical'
        }));

        res.status(200).json({
            success: true,
            attendance
        });
    } catch (error) {
        logger.error(`Error in GET student attendance: ${error.message}`);
        next(error);
    }
});

// GET /api/student/:id/subjects
router.get('/:id/subjects', requireAuth, async (req, res, next) => {
    try {
        const studentId = req.params.id;
        const student = await prisma.student.findFirst({
            where: { OR: [{ id: studentId }, { userId: studentId }] }
        });

        if (!student) {
            return res.status(404).json({ success: false, message: 'Student not found' });
        }

        const subjects = await prisma.subject.findMany({
            where: {
                semester: student.semester,
                branch: student.branch
            }
        });

        res.status(200).json({
            success: true,
            subjects
        });
    } catch (error) {
        logger.error(`Error in GET student subjects: ${error.message}`);
        next(error);
    }
});

// GET /api/student/:id/attendance/overall
router.get('/:id/attendance/overall', requireAuth, async (req, res, next) => {
    try {
        const studentId = req.params.id;
        const student = await prisma.student.findFirst({
            where: { OR: [{ id: studentId }, { userId: studentId }] }
        });

        if (!student) {
            return res.status(404).json({ success: false, message: 'Student not found' });
        }

        const records = await prisma.attendanceRecord.findMany({
            where: { studentId: student.id }
        });

        let totalHeld = 0;
        let totalAttended = 0;
        for (const r of records) {
            totalHeld += r.held;
            totalAttended += r.attended;
        }

        const percentage = totalHeld > 0 ? parseFloat(((totalAttended / totalHeld) * 100).toFixed(2)) : 0;
        res.status(200).json({
            success: true,
            held: totalHeld,
            attended: totalAttended,
            percentage: percentage,
            percentageString: percentage.toFixed(2) + '%'
        });
    } catch (error) {
        logger.error(`Error in GET student overall attendance: ${error.message}`);
        next(error);
    }
});

// GET /api/student/:id/fees
router.get('/:id/fees', requireAuth, async (req, res, next) => {
    try {
        const studentId = req.params.id;
        const student = await prisma.student.findFirst({
            where: { OR: [{ id: studentId }, { userId: studentId }] }
        });

        if (!student) {
            return res.status(404).json({ success: false, message: 'Student not found' });
        }

        const feesList = await prisma.fee.findMany({
            where: { studentId: student.id }
        });

        let totalAmountVal = 0;
        let paidAmountVal = 0;
        let dueAmountVal = 0;

        const transactions = feesList.map(fee => {
            totalAmountVal += fee.amount;
            paidAmountVal += fee.paidAmount;
            dueAmountVal += fee.dueAmount;

            const feeName = fee.feeType;
            return {
                title: feeName,
                amount: '₹' + fee.amount.toLocaleString('en-IN'),
                paid: '₹' + fee.paidAmount.toLocaleString('en-IN'),
                due: '₹' + fee.dueAmount.toLocaleString('en-IN'),
                ref: fee.id.substring(0, 8).toUpperCase(),
                date: fee.dueDate,
                icon: feeName.toLowerCase().includes('hostel') ? 'hotel' :
                      feeName.toLowerCase().includes('tuition') ? 'school' :
                      feeName.toLowerCase().includes('crt') ? 'terminal' : 'receipt_long',
                status: fee.paymentStatus,
                isRefund: false
            };
        });

        const totalAmount = '₹' + totalAmountVal.toLocaleString('en-IN');
        const paidAmount = '₹' + paidAmountVal.toLocaleString('en-IN');
        const dueAmount = '₹' + dueAmountVal.toLocaleString('en-IN');
        const totalDue = dueAmount;
        const paidProgress = totalAmountVal > 0 ? Math.min(100, Math.max(0, Math.round((paidAmountVal / totalAmountVal) * 100))) : 0;

        res.status(200).json({
            success: true,
            totalAmount,
            paidAmount,
            dueAmount,
            totalDue,
            paidProgress,
            transactions
        });
    } catch (error) {
        logger.error(`Error in GET student fees: ${error.message}`);
        next(error);
    }
});

// GET /api/student/:id/fees/history
router.get('/:id/fees/history', requireAuth, async (req, res, next) => {
    try {
        const studentId = req.params.id;
        const student = await prisma.student.findFirst({
            where: { OR: [{ id: studentId }, { userId: studentId }] }
        });

        if (!student) {
            return res.status(404).json({ success: false, message: 'Student not found' });
        }

        const feesList = await prisma.fee.findMany({
            where: { studentId: student.id, paidAmount: { gt: 0 } }
        });

        const history = feesList.map(fee => ({
            id: fee.id,
            feeType: fee.feeType,
            amount: fee.paidAmount,
            amountString: '₹' + fee.paidAmount.toLocaleString('en-IN'),
            date: fee.dueDate || '--',
            status: 'Completed',
            reference: 'REC-' + fee.id.substring(0, 8).toUpperCase()
        }));

        res.status(200).json({
            success: true,
            history
        });
    } catch (error) {
        logger.error(`Error in GET student fee history: ${error.message}`);
        next(error);
    }
});

module.exports = router;
