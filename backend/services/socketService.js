/**
 * SITAM Smart ERP — WebSocket Real-Time Push Service
 *
 * P0-2 Security Hardening:
 *   - First-message authentication protocol (no auth in URL)
 *   - configurable WS_AUTH_TIMEOUT_MS (default 5000)
 *   - Identity derived exclusively from verified session, never from client-supplied params
 *   - Raw bearer token is NEVER stored on the socket — SHA-256 hash only
 *   - O(1) heartbeat session revalidation via sessionManager.getSessionByTokenHash()
 *   - Distinct close codes: 4001=INVALID_SESSION, 4002=AUTH_TIMEOUT, 4003=MALFORMED_AUTH
 *   - No credentials in close reasons
 *   - updateLiveIndicator is driven by server auth_success message, not by socket open
 */
'use strict';

const ws = require('ws');
const crypto = require('crypto');
const logger = require('./logger');

// Configurable auth timeout — set WS_AUTH_TIMEOUT_MS in Railway env to override.
// Default: 5000 ms. Give slow-network devices (2G/congested WiFi) enough time
// to complete the TCP+TLS handshake AND send the first auth message.
const WS_AUTH_TIMEOUT_MS = parseInt(process.env.WS_AUTH_TIMEOUT_MS || '5000', 10);

class SocketService {
    constructor() {
        this.wss = null;
        this.clients = new Map(); // Maps userId -> Set of WS client sockets
    }

    /**
     * Initializes the WebSocket server using the existing HTTP server instance.
     */
    init(server) {
        this.wss = new ws.Server({
            server,
            maxPayload: 65536, // 64 KB — prevent oversized message attacks
        });
        logger.info('[Socket] WebSocket server initialized and bound to main HTTP server.');

        this.wss.on('connection', (socket, req) => {
            // ── Phase 1: Unauthenticated ─────────────────────────────────────────
            // Connection is accepted at TCP level (WebSocket upgrade), but the socket
            // is NOT trusted until the client sends a valid auth message.
            //
            // Design: Server waits WS_AUTH_TIMEOUT_MS for {"type":"auth","token":"<uuid>"}
            //   - Valid token   → auth_success sent, socket bound to session.userId
            //   - Invalid token → close(4001, INVALID_OR_EXPIRED_SESSION)
            //   - Timeout       → close(4002, AUTHENTICATION_TIMEOUT)
            //   - Malformed msg → close(4003, MALFORMED_AUTH_MESSAGE)
            //
            // The ?userId= query param is intentionally ignored — client identity is
            // derived exclusively from the verified session record.

            socket._authenticated = false;
            socket._tokenHash = null;   // SHA-256(rawToken) — raw token is discarded immediately
            socket.userId = null;       // set only after successful auth
            socket.isAlive = true;

            // Start authentication deadline
            const authDeadline = setTimeout(() => {
                if (!socket._authenticated) {
                    logger.warn('[Socket] Connection closed: authentication timeout (no valid auth message received).');
                    // 4002 = AUTH_TIMEOUT: client should reconnect (may be a slow network), NOT logout
                    socket.close(4002, 'AUTHENTICATION_TIMEOUT');
                }
            }, WS_AUTH_TIMEOUT_MS);

            // ── Message handler ──────────────────────────────────────────────────
            socket.on('message', async (rawMsg) => {
                // All messages before auth_success are auth messages.
                // After authentication, only heartbeat pong is expected (handled separately).
                if (!socket._authenticated) {
                    await this._handleAuthMessage(socket, rawMsg, authDeadline);
                    return;
                }
                // Post-auth: only metrics tracking (no application messages from client expected)
                try {
                    const metricsService = require('./metricsService');
                    metricsService.metrics.websocketMessagesTotal.inc({ direction: 'inbound' });
                } catch (_) {}
            });

            // ── Liveness ─────────────────────────────────────────────────────────
            socket.on('pong', () => {
                socket.isAlive = true;
            });

            // ── Cleanup on close ─────────────────────────────────────────────────
            socket.on('close', () => {
                clearTimeout(authDeadline); // safety: cancel auth timer if still pending
                if (socket.userId) {
                    const userSessions = this.clients.get(socket.userId);
                    if (userSessions) {
                        userSessions.delete(socket);
                        if (userSessions.size === 0) {
                            this.clients.delete(socket.userId);
                        }
                    }
                }

                try {
                    const metricsService = require('./metricsService');
                    metricsService.metrics.websocketConnectionsActive.set(
                        this.wss ? this.wss.clients.size : 0
                    );
                } catch (_) {}

                const { traceSpan } = require('../telemetry/tracing');
                traceSpan('websocket.disconnect', {
                    'messaging.system': 'websocket',
                    'user.id': socket.userId || 'unauthenticated',
                }, (span) => {
                    span.addEvent('websocket_client_disconnected', { userId: socket.userId || 'unauthenticated' });
                }).catch(() => {});

                if (socket.userId) {
                    logger.info(`[Socket] Student ${socket.userId} disconnected.`);
                }
            });

            socket.on('error', (err) => {
                logger.error(`[Socket] Socket error (userId=${socket.userId || 'unauthenticated'}): ${err.message}`);
            });
        });

        // ── Heartbeat interval (every 30 seconds) ────────────────────────────────
        // For authenticated sockets: also revalidate that the session is still live.
        // Uses getSessionByTokenHash() for O(1) lookup — no O(n) scan of all sessions.
        this.heartbeatInterval = setInterval(() => {
            this.wss.clients.forEach((socket) => {
                // Liveness check
                if (socket.isAlive === false) {
                    logger.warn(`[Socket] Terminating inactive socket (userId=${socket.userId || 'unauthenticated'}).`);
                    return socket.terminate();
                }
                socket.isAlive = false;

                // Session revalidation for authenticated sockets
                if (socket._authenticated && socket._tokenHash) {
                    const sessionManager = require('./sessionManager');
                    const session = sessionManager.getSessionByTokenHash(socket._tokenHash);
                    if (!session) {
                        // Session expired or was deleted (e.g., logout on another device)
                        logger.warn(`[Socket] Session expired for ${socket.userId}. Closing with 4001.`);
                        // 4001 = INVALID_OR_EXPIRED_SESSION: client should trigger logout flow
                        socket.close(4001, 'INVALID_OR_EXPIRED_SESSION');
                        return;
                    }
                }

                socket.ping();
            });
        }, 30000);
    }

    /**
     * Handles the first auth message from a new, unauthenticated socket.
     * Validates format, token, and session. Derives userId from session only.
     * Stores token hash (not raw token) on socket.
     * @private
     */
    async _handleAuthMessage(socket, rawMsg, authDeadline) {
        let msg;
        try {
            msg = JSON.parse(rawMsg);
        } catch (_) {
            logger.warn('[Socket] Malformed auth message: JSON parse failed.');
            clearTimeout(authDeadline);
            // 4003 = MALFORMED_AUTH_MESSAGE: client bug, not a session issue — no logout
            socket.close(4003, 'MALFORMED_AUTH_MESSAGE');
            return;
        }

        // Strict structure validation
        if (!msg || msg.type !== 'auth' || typeof msg.token !== 'string' || msg.token.trim() === '') {
            logger.warn('[Socket] Malformed auth message: expected {type:"auth",token:"<string>"}.');
            clearTimeout(authDeadline);
            socket.close(4003, 'MALFORMED_AUTH_MESSAGE');
            return;
        }

        // Validate token via session store — async, checks memory then DB
        const sessionManager = require('./sessionManager');
        let session;
        try {
            session = await sessionManager.getSessionAsync(msg.token);
        } catch (err) {
            logger.error(`[Socket] Session lookup error during WS auth: ${err.message}`);
            clearTimeout(authDeadline);
            socket.close(4001, 'INVALID_OR_EXPIRED_SESSION');
            return;
        }

        if (!session || !session.userId) {
            logger.warn('[Socket] WebSocket auth rejected: invalid or expired token.');
            clearTimeout(authDeadline);
            // 4001 = INVALID_OR_EXPIRED_SESSION: token is bad — client should trigger logout/re-login
            socket.close(4001, 'INVALID_OR_EXPIRED_SESSION');
            return;
        }

        // ── Authentication successful ────────────────────────────────────────────
        clearTimeout(authDeadline);

        // Derive userId from verified session — never from client-supplied query params or message fields
        const userId = session.userId;

        // Store hash of token, NEVER the raw token
        // Used by heartbeat for O(1) session revalidation via getSessionByTokenHash()
        socket._tokenHash = crypto.createHash('sha256').update(msg.token).digest('hex');
        socket._authenticated = true;
        socket.userId = userId;

        // Register in client map under verified userId
        if (!this.clients.has(userId)) {
            this.clients.set(userId, new Set());
        }
        this.clients.get(userId).add(socket);

        try {
            const metricsService = require('./metricsService');
            metricsService.metrics.websocketConnectionsActive.set(this.wss.clients.size);
        } catch (_) {}

        const { traceSpan } = require('../telemetry/tracing');
        traceSpan('websocket.connect', {
            'messaging.system': 'websocket',
            'user.id': userId,
            'dependency.type': 'internal',
            'dependency.name': 'websocket_server',
            'dependency.category': 'realtime_events',
            'dependency.criticality': 'medium',
        }, (span) => {
            span.addEvent('websocket_client_authenticated', { userId });
        }).catch(() => {});

        logger.info(`[Socket] Student ${userId} authenticated. Active sessions: ${this.clients.get(userId).size}`);

        // Send auth_success acknowledgement.
        // Client transitions to LIVE state ONLY after receiving this message.
        // updateLiveIndicator(true) is called on client only on receipt of auth_success.
        this.sendToSocket(socket, 'auth_success', {
            message: 'Authentication successful. Real-time sync active.',
            timestamp: new Date().toISOString(),
        });
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
                'messaging.event': event,
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
            'messaging.recipient_count': userSessions.size,
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
            'messaging.recipient_count': this.wss.clients.size,
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
