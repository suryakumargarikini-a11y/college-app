/**
 * SITAM Smart ERP — Background Sync Worker Daemon
 *
 * Standalone process that consumes BullMQ sync jobs from Redis.
 * Run separately: npm run worker
 * Scales horizontally — all instances share the same Redis queue.
 *
 * Features:
 *   - Browser pool shared across all concurrent job slots
 *   - Distributed lock release after each job completes
 *   - Worker health reporting
 *   - Graceful shutdown with browser pool teardown
 */

require('dotenv').config();
require('./telemetry/tracing');
const { Worker } = require('bullmq');
const redisService = require('./services/redisService');
const syncService = require('./services/syncService');
const syncQueue = require('./services/syncQueue');
const sessionManager = require('./services/sessionManager');
const workerService = require('./services/workerService');
const browserPool = require('./services/browserPool');
const { logger, runWithContext } = require('./services/logger');

const WORKER_ID = `worker-${process.pid}-${Date.now()}`;

logger.info(`[SyncWorker] Bootstrapping worker daemon... ID: ${WORKER_ID}`);
console.log(`[SyncWorker] Bootstrapping worker daemon... ID: ${WORKER_ID}`);

// Initialize Redis
redisService.connect();

// Initialize browser pool
browserPool.init()
    .then(() => logger.info(`[SyncWorker] Browser pool ready.`))
    .catch(err => logger.error(`[SyncWorker] Browser pool init failed: ${err.message}`));

// Wait briefly for Redis to establish connection
setTimeout(async () => {
    const connection = redisService.client;

    if (!connection) {
        logger.error('[SyncWorker] Redis client not available. Worker cannot start.');
        process.exit(1);
    }

    try {
        const metricsService = require('./services/metricsService');
        metricsService.metrics.workersActive.set({ worker: WORKER_ID }, 1);
    } catch (_) {}

    const worker = new Worker('sitam-sync', async (job) => {
        const { userId, password, forceFullSync, requestId = WORKER_ID, traceId = requestId, correlationId = requestId, tracingCarrier } = job.data;
        const startTime = Date.now();

        const ctx = {
            requestId,
            traceId,
            correlationId,
            userId,
            jobId: job.id,
            workerId: WORKER_ID
        };

        return runWithContext(ctx, async () => {
            const { propagation, context, tracer, INSTANCE_ID } = require('./telemetry/tracing');
            const { trace } = require('@opentelemetry/api');
            const parentContext = propagation.extract(context.active(), tracingCarrier || {});
            
            // Calculate queue drift and wait time
            const now = Date.now();
            const queueDriftTimeMs = Math.max(0, now - job.timestamp);
            
            // 1. Create standard queue wait span to map the lag timeline
            try {
                const waitSpan = tracer.startSpan('redis.queue.wait', {
                    attributes: {
                        'messaging.system': 'bullmq',
                        'messaging.destination': 'sitam-sync',
                        'queue.name': 'sitam-sync',
                        'queue.drift_time_ms': queueDriftTimeMs,
                        'service.name': 'sitam-worker',
                        'worker.id': WORKER_ID,
                        'service.instance.id': INSTANCE_ID
                    },
                    startTime: new Date(job.timestamp)
                }, parentContext);
                waitSpan.end(new Date(now));
            } catch (_) {}

            // 2. Start standardized worker sync execution span
            const attemptsMade = job.attemptsMade || 0;
            const span = tracer.startSpan('worker.sync.execute', {
                attributes: {
                    'messaging.system': 'bullmq',
                    'messaging.destination': 'sitam-sync',
                    'messaging.message_id': job.id,
                    'queue.name': 'sitam-sync',
                    'service.name': 'sitam-worker',
                    'worker.id': WORKER_ID,
                    'service.instance.id': INSTANCE_ID,
                    'userId': userId,
                    'forceFullSync': forceFullSync,
                    'queue.drift_time_ms': queueDriftTimeMs,
                    'job.attempts': attemptsMade
                }
            }, parentContext);

            if (attemptsMade > 0) {
                span.addEvent('queue_retry_triggered', { attempt: attemptsMade });
                span.setAttribute('anomaly', true);
                span.setAttribute('anomaly.type', 'worker_retry_storm');
                span.setAttribute('anomaly.severity', 'medium');
            }

            return context.with(trace.setSpan(parentContext, span), async () => {
                logger.info(`[SyncWorker] Processing job ${job.id} for ${userId} (forceFullSync: ${forceFullSync})`);

                let cookies = null;
                try {
                    const session = sessionManager.sessions.get(userId);
                    cookies = session ? session.cookies : null;

                    if (forceFullSync || !cookies) {
                        logger.info(`[SyncWorker] Full Puppeteer sync for ${userId}`);
                        await syncService.runFullSync(userId, password);
                    } else {
                        logger.info(`[SyncWorker] Incremental cookie sync for ${userId}`);
                        await syncQueue.syncStudentIncrementally(userId, password, cookies);
                    }

                    logger.info(`[SyncWorker] Job ${job.id} completed for ${userId}`);
                    span.setStatus({ code: 1 }); // 1 = Ok
                    return { success: true, userId, jobId: job.id, timestamp: new Date().toISOString() };

                } catch (err) {
                    span.recordException(err);
                    span.setStatus({ code: 2, message: err.message }); // 2 = Error
                    throw err;
                } finally {
                    span.end();
                    // Always release the distributed sync lock so future syncs can proceed
                    await workerService.releaseLock(userId);
                    logger.info(`[SyncWorker] Sync lock released for ${userId}`);

                    try {
                        const durationSec = (Date.now() - startTime) / 1000;
                        const metricsService = require('./services/metricsService');
                        metricsService.metrics.workerJobDuration.observe({ jobType: forceFullSync ? 'full' : 'incremental' }, durationSec);
                        metricsService.metrics.syncDurationSeconds.observe({ syncType: (forceFullSync || !cookies) ? 'full' : 'incremental' }, durationSec);
                    } catch (_) {}
                }
            });
        });
    }, {
        connection,
        concurrency: 2,         // Max 2 concurrent Puppeteer jobs (memory budget: ~600MB)
        limiter: {
            max: 5,
            duration: 10000     // Max 5 jobs per 10 seconds across all workers
        }
    });

    worker.on('active', (job) => {
        logger.info(`[SyncWorker] Job active: ${job.id}`);
    });

    worker.on('completed', (job, result) => {
        logger.info(`[SyncWorker] Job completed: ${job.id}`);
    });

    worker.on('failed', (job, err) => {
        const jobId = job ? job.id : 'unknown';
        logger.error(`[SyncWorker] Job failed: ${jobId} — ${err.message}`, { 
            tag: 'QUEUE_FAILURE',
            stack: err.stack 
        });
    });

    worker.on('stalled', (jobId) => {
        logger.warn(`[SyncWorker] Job stalled in queue: ${jobId}`, { 
            jobId,
            tag: 'QUEUE_STALL' 
        });
    });

    worker.on('error', (err) => {
        logger.error(`[SyncWorker] Worker error: ${err.message}`, { 
            tag: 'WORKER_CRASH',
            stack: err.stack 
        });
    });

    logger.info(`[SyncWorker] Worker listening on queue: sitam-sync (concurrency=2)`);

    // ─── Graceful Shutdown ──────────────────────────────────────────────────────
    const gracefulShutdown = async (signal) => {
        logger.info(`[SyncWorker] Received ${signal}. Initiating graceful teardown...`, { workerId: WORKER_ID });

        try {
            try {
                const metricsService = require('./services/metricsService');
                metricsService.metrics.workersActive.set({ worker: WORKER_ID }, 0);
            } catch (_) {}

            await worker.close();
            logger.info('[SyncWorker] BullMQ Worker closed.');

            await browserPool.shutdown();
            logger.info('[SyncWorker] Browser pool shut down.');

            await redisService.disconnect();
            logger.info('[SyncWorker] Redis disconnected. Worker shutdown complete.');

            process.exit(0);
        } catch (err) {
            logger.error(`[SyncWorker] Error during shutdown: ${err.message}`);
            process.exit(1);
        }
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT',  () => gracefulShutdown('SIGINT'));
    process.on('unhandledRejection', (reason) => {
        logger.error(`[SyncWorker] Unhandled Rejection: ${reason}`, { workerId: WORKER_ID });
    });

}, 1000); // 1s delay for Redis connection to establish
