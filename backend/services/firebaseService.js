const admin = require('firebase-admin');
const prisma = require('./dbService');
const logger = require('./logger');
const path = require('path');
const fs = require('fs');

let fcmInitialized = false;

try {
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

function getAndroidChannelAndPriority(type) {
    switch (type) {
        case 'exams':
            return { channelId: 'sitam_exam_alerts', priority: 'high' };
        case 'attendance':
            return { channelId: 'sitam_attendance_alerts', priority: 'high' };
        case 'marks':
            return { channelId: 'sitam_marks_alerts', priority: 'high' };
        case 'fees':
            return { channelId: 'sitam_fee_alerts', priority: 'high' };
        case 'assignments':
            return { channelId: 'sitam_assignment_alerts', priority: 'normal' };
        case 'timetable':
            return { channelId: 'sitam_timetable_alerts', priority: 'normal' };
        case 'announcement':
            return { channelId: 'sitam_announcements', priority: 'low' };
        default:
            return { channelId: 'sitam_academic_alerts', priority: 'normal' };
    }
}

/**
 * Dispatches a push notification to all registered FCM tokens for a student.
 * Falls back gracefully to websocket/logs if credentials are not configured.
 */
async function sendPushNotification(userId, title, message, dataPayload = {}) {
    const { traceSpan } = require('../telemetry/tracing');
    const { trace } = require('@opentelemetry/api');
    
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
            const student = await prisma.student.findUnique({
                where: { userId },
                include: { fcmTokens: true }
            });

            if (!student) {
                logger.error(`[FCM Push] Student with userId ${userId} not found.`);
                if (span) {
                    span.setAttribute('anomaly', true);
                    span.setAttribute('anomaly.type', 'firebase_student_missing');
                    span.setAttribute('anomaly.severity', 'medium');
                }
                return false;
            }

            const tokens = student.fcmTokens.map(t => t.token);

            if (tokens.length === 0) {
                logger.info(`[FCM Push] No active FCM devices registered for student: ${userId}. Mocking websocket log alert.`);
                if (span) span.addEvent('firebase_push_skipped_no_tokens', { userId });
                return false;
            }

            logger.info(`[FCM Push] Found ${tokens.length} active registered tokens for: ${userId}`);
            if (span) span.setAttribute('messaging.recipient_count', tokens.length);

            if (!fcmInitialized) {
                logger.info(`[FCM Push] [SANDBOX MOCK] Sent push payload to registered tokens [${tokens.join(', ')}]. Payload: "${title}: ${message}"`);
                if (span) span.addEvent('firebase_push_dispatched', { mock: true });
                return true;
            }

            const notificationType = dataPayload.type || 'general';
            const { channelId, priority } = getAndroidChannelAndPriority(notificationType);

            const messages = tokens.map(token => ({
                token,
                notification: {
                    title,
                    body: message
                },
                data: {
                    ...dataPayload,
                    click_action: 'FLUTTER_NOTIFICATION_CLICK',
                    sitam_route: dataPayload.route || '/dashboard'
                },
                android: {
                    priority,
                    notification: {
                        sound: 'default',
                        channelId,
                        icon: 'sitam_logo_notification'
                    }
                }
            }));

            const response = await admin.messaging().sendEach(messages);
            logger.info(`[FCM Push] Dispatched ${messages.length} FCM notifications. Success: ${response.successCount}, Failures: ${response.failureCount}`, {
                tag: 'FIREBASE_DELIVERY_SUMMARY',
                successCount: response.successCount,
                failureCount: response.failureCount
            });
            
            if (span) {
                span.addEvent('firebase_push_dispatched', {
                    successCount: response.successCount,
                    failureCount: response.failureCount
                });
            }

            // Clean up stale tokens
            if (response.failureCount > 0) {
                const tokensToDelete = [];
                response.responses.forEach((res, index) => {
                    if (!res.success) {
                        const errorCode = res.error?.code;
                        if (errorCode === 'messaging/registration-token-not-registered' || 
                            errorCode === 'messaging/invalid-registration-token') {
                            tokensToDelete.push(tokens[index]);
                        }
                    }
                });
                if (tokensToDelete.length > 0) {
                    await prisma.fcmToken.deleteMany({
                        where: { token: { in: tokensToDelete } }
                    });
                    logger.info(`[FCM Push] Cleaned up ${tokensToDelete.length} stale FCM tokens.`);
                }
            }

            if (response.failureCount > 0 && span) {
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
            
            if (span) {
                span.setAttribute('anomaly', true);
                span.setAttribute('anomaly.type', 'firebase_delivery_failure');
                span.setAttribute('anomaly.severity', 'high');
            }
            
            throw err;
        }
    });
}

/**
 * Send notification to a specific topic
 */
async function sendTopicNotification(topic, title, message, dataPayload = {}) {
    logger.info(`[FCM Topic Push] Preparing Topic Notification Alert [${title}] for topic: ${topic}`);
    if (!fcmInitialized) {
        logger.info(`[FCM Topic Push] [SANDBOX MOCK] Sent push payload to topic [${topic}]. Payload: "${title}: ${message}"`);
        return true;
    }
    try {
        const messagePayload = {
            topic,
            notification: {
                title,
                body: message
            },
            data: {
                ...dataPayload,
                click_action: 'FLUTTER_NOTIFICATION_CLICK',
                sitam_route: dataPayload.route || '/dashboard'
            },
            android: {
                priority: dataPayload.type === 'exams' ? 'high' : 'normal',
                notification: {
                    sound: 'default',
                    channelId: getAndroidChannelAndPriority(dataPayload.type || 'announcement').channelId,
                    icon: 'sitam_logo_notification'
                }
            }
        };

        const response = await admin.messaging().send(messagePayload);
        logger.info(`[FCM Topic Push] Topic message sent successfully to topic ${topic}. ID: ${response}`);
        return true;
    } catch (error) {
        logger.error(`[FCM Topic Push] Failed to send topic notification: ${error.message}`);
        throw error;
    }
}

/**
 * Subscribe tokens to a topic
 */
async function subscribeToTopic(tokens, topic) {
    const tokenArr = Array.isArray(tokens) ? tokens : [tokens];
    if (tokenArr.length === 0) return true;
    if (!fcmInitialized) {
        logger.info(`[FCM Topic] [SANDBOX MOCK] Subscribed tokens [${tokenArr.join(', ')}] to topic: ${topic}`);
        return true;
    }
    try {
        const response = await admin.messaging().subscribeToTopic(tokenArr, topic);
        logger.info(`[FCM Topic] Subscribed tokens to topic ${topic}. Success: ${response.successCount}, Failures: ${response.failureCount}`);
        return response;
    } catch (error) {
        logger.error(`[FCM Topic] Failed to subscribe to topic ${topic}: ${error.message}`);
        throw error;
    }
}

/**
 * Unsubscribe tokens from a topic
 */
async function unsubscribeFromTopic(tokens, topic) {
    const tokenArr = Array.isArray(tokens) ? tokens : [tokens];
    if (tokenArr.length === 0) return true;
    if (!fcmInitialized) {
        logger.info(`[FCM Topic] [SANDBOX MOCK] Unsubscribed tokens [${tokenArr.join(', ')}] from topic: ${topic}`);
        return true;
    }
    try {
        const response = await admin.messaging().unsubscribeFromTopic(tokenArr, topic);
        logger.info(`[FCM Topic] Unsubscribed tokens from topic ${topic}. Success: ${response.successCount}, Failures: ${response.failureCount}`);
        return response;
    } catch (error) {
        logger.error(`[FCM Topic] Failed to unsubscribe from topic ${topic}: ${error.message}`);
        throw error;
    }
}

/**
 * Sends a list of customized messages to individual users in batch.
 * Messages should look like: { token, title, message, data }
 */
async function batchSendNotifications(messages) {
    if (messages.length === 0) return { successCount: 0, failureCount: 0 };
    logger.info(`[FCM Batch Push] Preparing to send ${messages.length} batch notifications.`);
    if (!fcmInitialized) {
        logger.info(`[FCM Batch Push] [SANDBOX MOCK] Dispatched ${messages.length} mock batch notifications.`);
        return { successCount: messages.length, failureCount: 0 };
    }

    try {
        const chunks = [];
        for (let i = 0; i < messages.length; i += 500) {
            chunks.push(messages.slice(i, i + 500));
        }

        let totalSuccessCount = 0;
        let totalFailureCount = 0;

        for (const chunk of chunks) {
            const formattedMessages = chunk.map(msg => {
                const notificationType = msg.data?.type || 'general';
                const { channelId, priority } = getAndroidChannelAndPriority(notificationType);
                return {
                    token: msg.token,
                    notification: {
                        title: msg.title,
                        body: msg.message
                    },
                    data: {
                        ...msg.data,
                        click_action: 'FLUTTER_NOTIFICATION_CLICK',
                        sitam_route: msg.data?.route || '/dashboard'
                    },
                    android: {
                        priority,
                        notification: {
                            sound: 'default',
                            channelId,
                            icon: 'sitam_logo_notification'
                        }
                    }
                };
            });

            const response = await admin.messaging().sendEach(formattedMessages);
            totalSuccessCount += response.successCount;
            totalFailureCount += response.failureCount;

            if (response.failureCount > 0) {
                const tokensToDelete = [];
                response.responses.forEach((res, index) => {
                    if (!res.success) {
                        const errorCode = res.error?.code;
                        if (errorCode === 'messaging/registration-token-not-registered' || 
                            errorCode === 'messaging/invalid-registration-token') {
                            tokensToDelete.push(formattedMessages[index].token);
                        }
                    }
                });
                if (tokensToDelete.length > 0) {
                    await prisma.fcmToken.deleteMany({
                        where: { token: { in: tokensToDelete } }
                    });
                    logger.info(`[FCM Batch Push] Cleaned up ${tokensToDelete.length} stale FCM tokens.`);
                }
            }
        }

        logger.info(`[FCM Batch Push] Batch send complete. Total success: ${totalSuccessCount}, failures: ${totalFailureCount}`);
        return { successCount: totalSuccessCount, failureCount: totalFailureCount };
    } catch (error) {
        logger.error(`[FCM Batch Push] Error sending batch: ${error.message}`);
        throw error;
    }
}

module.exports = {
    sendPushNotification,
    sendTopicNotification,
    subscribeToTopic,
    unsubscribeFromTopic,
    batchSendNotifications,
    isFcmReady: () => fcmInitialized
};
