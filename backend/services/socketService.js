const ws = require('ws');
const logger = require('./logger');

class SocketService {
    constructor() {
        this.wss = null;
        this.clients = new Map(); // Maps userId -> Set of WS client sockets
    }

    /**
     * Initializes the WebSocket server using the existing HTTP server instance.
     */
    init(server) {
        this.wss = new ws.Server({ server });
        logger.info('[Socket] WebSocket server initialized and bound to main HTTP server.');

        this.wss.on('connection', (socket, req) => {
            const url = new URL(req.url, 'http://localhost');
            const userId = url.searchParams.get('userId');
            const traceparent = url.searchParams.get('traceparent') || url.searchParams.get('traceId');

            if (!userId) {
                logger.warn('[Socket] Connection rejected: No userId provided in query params.');
                socket.close(4000, 'Missing userId in query parameters');
                return;
            }

            // Keep track of connection
            socket.userId = userId;
            socket.isAlive = true;

            if (!this.clients.has(userId)) {
                this.clients.set(userId, new Set());
            }
            this.clients.get(userId).add(socket);

            try {
                const metricsService = require('./metricsService');
                metricsService.metrics.websocketConnectionsActive.set(this.wss.clients.size);
            } catch (_) {}

            const { traceSpan } = require('../telemetry/tracing');

            // Trace websocket connect
            traceSpan('websocket.connect', {
                'messaging.system': 'websocket',
                'user.id': userId,
                'dependency.type': 'internal',
                'dependency.name': 'websocket_server',
                'dependency.category': 'realtime_events',
                'dependency.criticality': 'medium'
            }, (span) => {
                span.addEvent('websocket_client_connected', { userId, ip: req.ip });
                if (traceparent) {
                    span.setAttribute('client.traceparent', traceparent);
                }
            }).catch(() => {});

            logger.info(`[Socket] Student ${userId} connected. Total active sessions: ${this.clients.get(userId).size}`);

            // Heartbeat check
            socket.on('pong', () => {
                socket.isAlive = true;
            });

            // Track inbound messages
            socket.on('message', () => {
                try {
                    const metricsService = require('./metricsService');
                    metricsService.metrics.websocketMessagesTotal.inc({ direction: 'inbound' });
                } catch (_) {}
            });

            socket.on('close', () => {
                const userSessions = this.clients.get(userId);
                if (userSessions) {
                    userSessions.delete(socket);
                    if (userSessions.size === 0) {
                        this.clients.delete(userId);
                    }
                }
                
                try {
                    const metricsService = require('./metricsService');
                    metricsService.metrics.websocketConnectionsActive.set(this.wss ? this.wss.clients.size : 0);
                } catch (_) {}

                traceSpan('websocket.disconnect', {
                    'messaging.system': 'websocket',
                    'user.id': userId
                }, (span) => {
                    span.addEvent('websocket_client_disconnected', { userId });
                }).catch(() => {});

                logger.info(`[Socket] Student ${userId} disconnected.`);
            });

            socket.on('error', (err) => {
                logger.error(`[Socket] Error on student socket ${userId}: ${err.message}`);
            });

            // Welcome message
            this.sendToSocket(socket, 'welcome', {
                message: 'Real-time synchronization engine connected.',
                timestamp: new Date().toISOString()
            });
        });

        // Start heartbeat interval (every 30 seconds)
        this.heartbeatInterval = setInterval(() => {
            this.wss.clients.forEach((socket) => {
                if (socket.isAlive === false) {
                    logger.warn(`[Socket] Terminating inactive socket for student: ${socket.userId}`);
                    return socket.terminate();
                }

                socket.isAlive = false;
                socket.ping();
            });
        }, 30000);
    }

    /**
     * Sends a JSON event message to a specific socket.
     */
    sendToSocket(socket, event, data) {
        if (socket.readyState === ws.OPEN) {
            const { traceSpan } = require('../telemetry/tracing');
            traceSpan('websocket.send.message', {
                'messaging.system': 'websocket',
                'messaging.destination': socket.userId || 'unknown',
                'messaging.event': event
            }, (span) => {
                try {
                    socket.send(JSON.stringify({ event, data }));
                    try {
                        const metricsService = require('./metricsService');
                        metricsService.metrics.websocketMessagesTotal.inc({ direction: 'outbound' });
                    } catch (_) {}
                } catch (err) {
                    logger.error(`[Socket] Failed to send to socket: ${err.message}`);
                    throw err;
                }
            }).catch(() => {});
        }
    }

    /**
     * Broadcasts a real-time event message to all active sessions of a specific student.
     */
    sendToUser(userId, event, data) {
        const userSessions = this.clients.get(userId);
        if (!userSessions || userSessions.size === 0) {
            logger.debug(`[Socket] No active WebSockets for student ${userId} to send event "${event}".`);
            return false;
        }

        const { traceSpan } = require('../telemetry/tracing');
        traceSpan('websocket.broadcast.message', {
            'messaging.system': 'websocket',
            'user.id': userId,
            'messaging.event': event,
            'messaging.recipient_count': userSessions.size
        }, () => {
            logger.info(`[Socket] Broadcasting event "${event}" to ${userSessions.size} session(s) for student: ${userId}`);
            userSessions.forEach((socket) => {
                this.sendToSocket(socket, event, data);
            });
        }).catch(() => {});

        return true;
    }

    /**
     * Broadcasts a message to all connected students (global announcements).
     */
    broadcast(event, data) {
        if (!this.wss) return;
        const { traceSpan } = require('../telemetry/tracing');
        traceSpan('websocket.broadcast.message', {
            'messaging.system': 'websocket',
            'messaging.event': event,
            'messaging.recipient_count': this.wss.clients.size
        }, () => {
            logger.info(`[Socket] Broadcasting global event "${event}" to all connected students.`);
            this.wss.clients.forEach((socket) => {
                this.sendToSocket(socket, event, data);
            });
        }).catch(() => {});
    }

    /**
     * Clean shutdown of the WebSocket server and intervals.
     */
    shutdown() {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
        }
        if (this.wss) {
            this.wss.close();
        }
    }
}

module.exports = new SocketService();
