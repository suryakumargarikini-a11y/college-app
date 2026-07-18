'use strict';

const prisma = require('./dbService');
const logger = require('./logger');

const SMS_PROVIDER = process.env.SMS_PROVIDER || 'CONSOLE'; // MOCK, CONSOLE, TWILIO

// Helper to mask phone numbers
function maskPhoneNumber(phone) {
    if (!phone) return '';
    const str = phone.trim();
    if (str.length < 5) return '***';
    const visibleCount = 4;
    const startVisible = str.startsWith('+') ? 3 : 2;
    const maskedLength = str.length - startVisible - visibleCount;
    if (maskedLength <= 0) {
        return str.substring(0, 1) + '*'.repeat(str.length - 2) + str.slice(-1);
    }
    return str.substring(0, startVisible) + '*'.repeat(maskedLength) + str.slice(-visibleCount);
}

/**
 * Sends SMS asynchronously and logs results in SmsLog table.
 * SMS failure does not throw errors to block the main caller.
 */
async function sendSms({ to, message, studentId, passId, type }) {
    const maskedRecipient = maskPhoneNumber(to);
    logger.info(`[SMS] Initiating send to ${maskedRecipient} (Type: ${type})`);

    // Run the actual API call / output in background and write to log DB.
    // Return the promise so that test suites can optionally await it.
    const promise = (async () => {
        let status = 'SENT';
        let error = null;

        try {
            if (SMS_PROVIDER === 'TWILIO') {
                const accountSid = process.env.TWILIO_ACCOUNT_SID;
                const authToken = process.env.TWILIO_AUTH_TOKEN;
                const fromNumber = process.env.TWILIO_FROM_NUMBER;

                if (!accountSid || !authToken || !fromNumber) {
                    throw new Error('Twilio configuration missing');
                }

                const twilio = require('twilio');
                const client = twilio(accountSid, authToken);

                await client.messages.create({
                    body: message,
                    from: fromNumber,
                    to: to
                });
            } else if (SMS_PROVIDER === 'CONSOLE') {
                console.log(`\n--- [SMS CONSOLE SENDER] ---\nTo: ${to}\nMessage: ${message}\n-----------------------------\n`);
            } else if (SMS_PROVIDER === 'MOCK') {
                logger.info(`[SMS MOCK] Simulated send to ${maskedRecipient}: ${message}`);
            } else {
                throw new Error(`Unsupported SMS provider: ${SMS_PROVIDER}`);
            }
        } catch (err) {
            status = 'FAILED';
            error = err.message;
            logger.error(`[SMS] Failed to send SMS to ${maskedRecipient}:`, err);
        }

        try {
            await prisma.smsLog.create({
                data: {
                    studentId,
                    passId,
                    type,
                    recipient: maskedRecipient,
                    status,
                    error
                }
            });
        } catch (dbErr) {
            logger.error('[SMS] Failed to write SmsLog to database:', dbErr);
        }
    })();

    // Return the background execution promise
    return promise;
}

module.exports = {
    sendSms,
    maskPhoneNumber
};
