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

            const REMINDER_DAYS = new Set([15, 10, 7, 5, 3, 1]);

            // ── Step 1: Load all unpaid fees ─────────────────────────────────────
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

            // ── Step 2: Filter to ONLY fees that fall on a reminder day ──────────
            // This avoids hitting feeReminderLog for fees that don't need reminders today.
            const candidateFees = [];
            const stageMap = new Map(); // feeId → stage

            for (const fee of outstandingFees) {
                if (!fee.student || !fee.dueDate) continue;

                const due = new Date(fee.dueDate);
                due.setHours(0, 0, 0, 0);
                const diffDays = Math.ceil((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

                if (!REMINDER_DAYS.has(diffDays)) continue;

                const stage = `${diffDays}_DAY`;
                stageMap.set(fee.id, stage);
                candidateFees.push(fee);
            }

            if (candidateFees.length === 0) {
                logger.info('[FeeReminderScheduler] No fees due on a reminder day today. Skipping.');
                return;
            }

            // ── Step 3: SINGLE bulk query for all existing reminder logs ─────────
            // Was: N individual findUnique calls (N+1 query problem).
            // Now:  1 query → in-memory Set → O(1) dedup per fee.
            const feeIds = candidateFees.map(f => f.id);
            const existingLogs = await prisma.feeReminderLog.findMany({
                where: {
                    feeId: { in: feeIds }
                },
                select: {
                    studentId: true,
                    feeId: true,
                    reminderStage: true
                }
            });

            // Build dedup Set: key = `${studentId}:${feeId}:${stage}`
            const sentSet = new Set(
                existingLogs.map(l => `${l.studentId}:${l.feeId}:${l.reminderStage}`)
            );

            // ── Step 4: Process candidates ───────────────────────────────────────
            let reminderSentCount = 0;

            for (const fee of candidateFees) {
                const stage = stageMap.get(fee.id);
                const dedupKey = `${fee.studentId}:${fee.id}:${stage}`;

                if (sentSet.has(dedupKey)) {
                    logger.debug(`[FeeReminderScheduler] stage ${stage} already sent for fee ${fee.id}. Skipping.`);
                    continue;
                }

                try {
                    // Send push notification
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

                    // Create in-app notification
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

                    // Log the send to prevent duplicate alerts
                    await prisma.feeReminderLog.create({
                        data: {
                            studentId: fee.studentId,
                            feeId: fee.id,
                            reminderStage: stage
                        }
                    });

                    // Add to in-memory dedup set to prevent double-send within same run
                    sentSet.add(dedupKey);
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


