/**
 * SITAM Smart ERP — Background Sync Scheduler (Queue Daemon)
 *
 * Scans active sessions in ProviderSessionManager every 60 seconds.
 * If a session is active, triggers background sync by enqueuing a job
 * in WorkerService.
 *
 * Zero direct Puppeteer or low-level HTTP calls — all syncs are routed
 * through the provider/worker layer.
 */

'use strict';

const logger = require('./logger');
const ProviderSessionManager = require('../providers/session/ProviderSessionManager');
const workerService = require('./workerService');
const { studentRepository } = require('../repositories');

class SyncQueue {
    constructor() {
        this.workers = new Map(); // Keep compatibility for workers list if referenced
        this.queueTimer = null;
    }

    /**
     * Start background sync workers for all active sessions in ProviderSessionManager.
     */
    start() {
        logger.info('[SyncQueue] Initializing scheduled background sync workers.');
        
        // Main queue tick: runs every 60 seconds to scan active sessions and schedule individual syncs
        this.queueTimer = setInterval(() => this.tick(), 60000);
        
        // Run first tick immediately in background
        this.tick();
    }

    /**
     * Scan active sessions and trigger background synchronization if needed.
     */
    async tick() {
        try {
            const activeUserIds = await ProviderSessionManager.getActiveSessions();
            logger.info(`[SyncQueue] Scanning ${activeUserIds.length} active sessions for background synchronization...`);
            
            for (const userId of activeUserIds) {
                // If a worker is already running or scheduled for this user, skip
                if (this.workers.has(userId)) {
                    continue;
                }

                // Load the student's password securely from database for the background re-auth
                const student = await studentRepository.findByUserId(userId);
                if (!student || !student.password) {
                    logger.warn(`[SyncQueue] No credentials found in DB for active session user ${userId}. Skipping.`);
                    continue;
                }

                // Schedule and enqueue sync through decoupled worker manager (non-force incremental sync)
                workerService.enqueueSync(userId, student.password, false)
                    .catch(err => logger.error(`[SyncQueue] Failed to enqueue background sync for ${userId}: ${err.message}`));
            }
        } catch (err) {
            logger.error(`[SyncQueue] Error in background sync scan tick: ${err.message}`);
        }
    }

    /**
     * Clean shutdown of scheduled queues.
     */
    shutdown() {
        if (this.queueTimer) {
            clearInterval(this.queueTimer);
        }
    }
}

module.exports = new SyncQueue();
