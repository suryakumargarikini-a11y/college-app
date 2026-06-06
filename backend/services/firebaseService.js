const admin = require('firebase-admin');
const prisma = require('./dbService');
const logger = require('./logger');
const path = require('path');
const fs = require('fs');

let fcmInitialized = false;

try {
    // Determine path to Google Services credential file
    const serviceAccountPath = process.env.FIREBASE_CREDENTIALS || path.join(__dirname, '..', 'google-services-key.json');
    
    if (fs.existsSync(serviceAccountPath)) {
        const serviceAccount = require(serviceAccountPath);
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
        logger.info('[FirebaseService] Successfully initialized Firebase Admin using local certificate.');
        fcmInitialized = true;
    } else if (process.env.FIREBASE_CREDENTIALS_JSON) {
        const serviceAccount = JSON.parse(process.env.FIREBASE_CREDENTIALS_JSON);
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
        logger.info('[FirebaseService] Successfully initialized Firebase Admin using env JSON credentials.');
        fcmInitialized = true;
    } else {
        logger.warn('[FirebaseService] Firebase Admin credentials not found. FCM will run in Local Sandbox Mock Mode.');
    }
} catch (error) {
    logger.error(`[FirebaseService] Initialization error: ${error.message}. Running in Mock Mode.`);
}

/**
 * Dispatches a push notification to all registered FCM tokens for a student.
 * Falls back gracefully to websocket/logs if credentials are not configured.
 */
async function sendPushNotification(userId, title, message, dataPayload = {}) {
    const { traceSpan } = require('../telemetry/tracing');
    const { trace } = require('@opentelemetry/api');
    
    // Embed traceparent for mobile client correlation if active
    try {
        const activeSpan = trace.getActiveSpan();
        if (activeSpan) {
            const spanCtx = activeSpan.spanContext();
            if (spanCtx && spanCtx.traceId) {
                dataPayload.traceparent = `00-${spanCtx.traceId}-${spanCtx.spanId}-01`;
                dataPayload.traceId = spanCtx.traceId;
            }
        }
    } catch (_) {}

    return traceSpan('firebase.notification.send', {
        'messaging.system': 'firebase',
        'user.id': userId,
        'notification.title': title,
        'dependency.type': 'external',
        'dependency.name': 'firebase',
        'dependency.category': 'notification_dispatch',
        'dependency.criticality': 'low'
    }, async (span) => {
        logger.info(`[FCM Push] Preparing SITAM Notification Alert [${title}] for student: ${userId}`);
        
        try {
            // Query student & their tokens
            const student = await prisma.student.findUnique({
                where: { userId },
                include: { fcmTokens: true }
            });

            if (!student) {
                logger.error(`[FCM Push] Student with userId ${userId} not found.`);
                span.setAttribute('anomaly', true);
                span.setAttribute('anomaly.type', 'firebase_student_missing');
                span.setAttribute('anomaly.severity', 'medium');
                return false;
            }

            const tokens = student.fcmTokens.map(t => t.token);

            if (tokens.length === 0) {
                logger.info(`[FCM Push] No active FCM devices registered for student: ${userId}. Mocking websocket log alert.`);
                span.addEvent('firebase_push_skipped_no_tokens', { userId });
                return false;
            }

            logger.info(`[FCM Push] Found ${tokens.length} active registered tokens for: ${userId}`);
            span.setAttribute('messaging.recipient_count', tokens.length);

            if (!fcmInitialized) {
                logger.info(`[FCM Push] [SANDBOX MOCK] Sent push payload to registered tokens [${tokens.join(', ')}]. Payload: "${title}: ${message}"`);
                span.addEvent('firebase_push_dispatched', { mock: true });
                return true;
            }

            // Build FCM message payload
            const messages = tokens.map(token => ({
                token,
                notification: {
                    title,
                    body: message
                },
                data: {
                    ...dataPayload,
                    click_action: 'FLUTTER_NOTIFICATION_CLICK', // standard native trigger
                    sitam_route: dataPayload.route || '/dashboard'
                },
                android: {
                    priority: 'high',
                    notification: {
                        sound: 'default',
                        channelId: 'sitam_academic_alerts', // android channel id
                        icon: 'sitam_logo_notification'
                    }
                }
            }));

            // Send using FCM Admin
            const response = await admin.messaging().sendEach(messages);
            logger.info(`[FCM Push] Dispatched ${messages.length} FCM notifications. Success: ${response.successCount}, Failures: ${response.failureCount}`, {
                tag: 'FIREBASE_DELIVERY_SUMMARY',
                successCount: response.successCount,
                failureCount: response.failureCount
            });
            
            span.addEvent('firebase_push_dispatched', {
                successCount: response.successCount,
                failureCount: response.failureCount
            });

            if (response.failureCount > 0) {
                span.setAttribute('anomaly', true);
                span.setAttribute('anomaly.type', 'firebase_delivery_partial_failure');
                span.setAttribute('anomaly.severity', 'medium');
            }

            return true;

        } catch (err) {
            logger.error(`[FCM Push] Failed to deliver FCM messages: ${err.message}`, {
                tag: 'FIREBASE_DELIVERY_FAILURE',
                stack: err.stack
            });
            
            span.setAttribute('anomaly', true);
            span.setAttribute('anomaly.type', 'firebase_delivery_failure');
            span.setAttribute('anomaly.severity', 'high');
            
            throw err;
        }
    });
}

module.exports = {
    sendPushNotification,
    isFcmReady: () => fcmInitialized
};
