'use strict';
const prisma = require('./dbService');
const logger = require('./logger');

const CHECK_INTERVAL = 24 * 60 * 60 * 1000; // Run once every 24 hours

class FeeReminderScheduler {
    constructor() {
        this._started = false;
        this._intervalId = null;
    }

    start() {
        if (this._started) return;
        this._started = true;
        logger.info('[FeeReminderScheduler] Starting Daily Fee Reminder Scheduler...');
        
        // Execute immediately on startup, then on interval
        this.runCheck().catch(err => logger.error('[FeeReminderScheduler] Initial run failed:', err));
        
        this._intervalId = setInterval(() => {
            this.runCheck().catch(err => logger.error('[FeeReminderScheduler] Daily check failed:', err));
        }, CHECK_INTERVAL);
    }

    stop() {
        if (!this._started) return;
        if (this._intervalId) {
            clearInterval(this._intervalId);
            this._intervalId = null;
        }
        this._started = false;
        logger.info('[FeeReminderScheduler] Fee Reminder Scheduler stopped.');
    }

    async runCheck() {
        logger.info('[FeeReminderScheduler] Running daily check for due fees...');
        try {
            const now = new Date();
            now.setHours(0, 0, 0, 0);

            // Fetch all unpaid fees with student and FCM token information
            const outstandingFees = await prisma.fee.findMany({
                where: {
                    dueAmount: { gt: 0 }
                },
                include: {
                    student: {
                        select: {
                            id: true,
                            name: true,
                            email: true,
                            fcmTokens: { select: { token: true } }
                        }
                    }
                }
            });

            logger.info(`[FeeReminderScheduler] Found ${outstandingFees.length} outstanding fee records to evaluate.`);

            let reminderSentCount = 0;

            for (const fee of outstandingFees) {
                if (!fee.student || !fee.dueDate) continue;

                // Parse due date and calculate remaining days
                const due = new Date(fee.dueDate);
                due.setHours(0, 0, 0, 0);

                const diffTime = due.getTime() - now.getTime();
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

                let stage = null;
                if (diffDays === 15) stage = '15_DAY';
                else if (diffDays === 10) stage = '10_DAY';
                else if (diffDays === 7) stage = '7_DAY';
                else if (diffDays === 5) stage = '5_DAY';
                else if (diffDays === 3) stage = '3_DAY';
                else if (diffDays === 1) stage = '1_DAY';

                // Skip if not on a reminder target day
                if (!stage) continue;

                try {
                    // Check if reminder was already sent for this stage
                    const alreadySent = await prisma.feeReminderLog.findUnique({
                        where: {
                            studentId_feeId_reminderStage: {
                                studentId: fee.studentId,
                                feeId: fee.id,
                                reminderStage: stage
                            }
                        }
                    });

                    if (alreadySent) {
                        logger.debug(`[FeeReminderScheduler] stage ${stage} already sent for fee ${fee.id} student ${fee.studentId}. Skipping.`);
                        continue;
                    }

                    // 1. Send push notification to all student devices
                    const tokens = fee.student.fcmTokens.map(t => t.token);
                    const title = '⚠️ Fee Payment Due Alert';
                    const message = `Dear ${fee.student.name}, your ${fee.feeType} fee of ₹${fee.dueAmount} is due on ${fee.dueDate}. Please clear it to avoid mid-exam ticket blocking.`;

                    if (tokens.length > 0) {
                        try {
                            const firebaseService = require('./firebaseService');
                            if (firebaseService.sendToTokens) {
                                await firebaseService.sendToTokens(tokens, title, message);
                            }
                        } catch (fcmErr) {
                            logger.warn(`[FeeReminderScheduler] FCM delivery failed for student ${fee.studentId}: ${fcmErr.message}`);
                        }
                    }

                    // 2. Append a notification to the student's dashboard logs
                    await prisma.notification.create({
                        data: {
                            studentId: fee.studentId,
                            title,
                            message,
                            type: 'fees',
                            category: 'reminder',
                            date: new Date().toISOString().split('T')[0],
                            metadata: JSON.stringify({ 
                                feeId: fee.id, 
                                dueAmount: fee.dueAmount, 
                                dueDate: fee.dueDate,
                                hallTicketBlockWarning: true 
                            })
                        }
                    });

                    // 3. Log the send event to prevent double alerts
                    await prisma.feeReminderLog.create({
                        data: {
                            studentId: fee.studentId,
                            feeId: fee.id,
                            reminderStage: stage
                        }
                    });

                    reminderSentCount++;
                    logger.info(`[FeeReminderScheduler] Dispatched stage ${stage} reminder for fee ${fee.id} to student ${fee.studentId}`);

                } catch (recordErr) {
                    logger.error(`[FeeReminderScheduler] Failed to process reminder for fee ${fee.id}:`, recordErr);
                }
            }

            logger.info(`[FeeReminderScheduler] Daily due fee evaluation finished. Sent ${reminderSentCount} reminders.`);
        } catch (err) {
            logger.error('[FeeReminderScheduler] Error running due fee check:', err);
        }
    }
}

module.exports = new FeeReminderScheduler();
