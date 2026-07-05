/**
 * SITAM Smart ERP — Inline Queue Worker
 *
 * Bootstraps a BullMQ worker inline within the main Express server process.
 * Reuses the existing Redis connection and Browser Pool.
 * Used when running as a single consolidated web service (e.g., Render).
 */

'use strict';

const { Worker } = require('bullmq');
const redisService = require('./redisService');
const syncService = require('./syncService');
const workerService = require('./workerService');
const browserPool = require('./browserPool');
const { logger, runWithContext } = require('./logger');

const qpm = require('../providers/scraper/throttle/QueuePressureManager');
const shedder = require('../providers/scraper/throttle/AdaptiveLoadShedding');
const forecaster = require('../providers/scraper/forecasting/ScraperReliabilityForecaster');
const classifier = require('../providers/scraper/retry/AdaptiveRetryClassifier');

const WORKER_ID = `worker-inline-${process.pid}`;

// Lazy helpers to avoid circular dependency
const getObs = () => {
    try { return require('./ObservabilityScheduler'); } catch (_) { return null; }
};
const getBC  = () => { const s = getObs(); return s ? s.getBusinessCollector() : null; };
const getAR  = () => { const s = getObs(); return s ? s.getAlertRouter() : null; };

function startInlineWorker() {
    if (!redisService.isAlive()) {
        logger.warn('[InlineWorker] Redis is offline. Skipping inline worker bootstrap.');
        return null;
    }

    logger.info(`[InlineWorker] Bootstrapping inline worker process... ID: ${WORKER_ID}`);
    const connection = redisService.client;

    forecaster.startPeriodicForecasting();

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
            const { propagation, context, tracer, INSTANCE_ID } = require('../telemetry/tracing');
            const { trace } = require('@opentelemetry/api');
            const parentContext = propagation.extract(context.active(), tracingCarrier || {});
            
            const now = Date.now();
            const queueDriftTimeMs = Math.max(0, now - job.timestamp);
            
            // Queue wait span
            try {
                const waitSpan = tracer.startSpan('redis.queue.wait', {
                    attributes: {
                        'messaging.system': 'bullmq',
                        'messaging.destination': 'sitam-sync',
                        'queue.name': 'sitam-sync',
                        'queue.drift_time_ms': queueDriftTimeMs,
                        'service.name': 'sitam-worker-inline',
                        'worker.id': WORKER_ID,
                        'service.instance.id': INSTANCE_ID
                    },
                    startTime: new Date(job.timestamp)
                }, parentContext);
                waitSpan.end(new Date(now));
            } catch (_) {}

            // Worker execute span
            const attemptsMade = job.attemptsMade || 0;
            const span = tracer.startSpan('worker.sync.execute', {
                attributes: {
                    'messaging.system': 'bullmq',
                    'messaging.destination': 'sitam-sync',
                    'messaging.message_id': job.id,
                    'queue.name': 'sitam-sync',
                    'service.name': 'sitam-worker-inline',
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
                logger.info(`[InlineWorker] Processing job ${job.id} for ${userId} (forceFullSync: ${forceFullSync})`);

                // Record queue depth
                try {
                    const depth = await connection.llen('bull:sitam-sync:wait');
                    if (typeof depth === 'number') {
                        forecaster.recordQueueDepth(depth);
                    }
                } catch (_) {}

                const basePriority = forceFullSync ? 'high' : 'low';
                qpm.registerWaiting(userId, basePriority);
                const priority = qpm.getEffectivePriority(userId, basePriority);

                try {
                    const bc = getBC();
                    if (bc && bc.queueWaitHistogram) {
                        bc.queueWaitHistogram.labels(basePriority).observe(queueDriftTimeMs / 1000);
                    }
                    if (bc && bc.syncStartedCounter) {
                        bc.syncStartedCounter.labels(forceFullSync ? 'full' : 'incremental').inc();
                    }
                } catch (_) {}

                const isBackground = !forceFullSync;
                
                if (isBackground) {
                    const throttleResult = qpm.shouldThrottle(userId, priority);
                    if (throttleResult.throttle) {
                        if (throttleResult.delayMs === -1) {
                            logger.warn(`[InlineWorker] Dropping background job for ${userId}: ${throttleResult.reason}`);
                            qpm.releaseActive(userId);
                            return { success: false, reason: throttleResult.reason };
                        } else {
                            logger.warn(`[InlineWorker] Throttling background job for ${userId} by ${throttleResult.delayMs}ms: ${throttleResult.reason}`);
                            await new Promise(r => setTimeout(r, throttleResult.delayMs));
                        }
                    }

                    const admission = shedder.admitSync({ priority, triggeredByUser: false });
                    if (!admission.admitted) {
                        logger.warn(`[InlineWorker] Shedding background job for ${userId}: ${admission.reason}`);
                        qpm.releaseActive(userId);
                        return { success: false, reason: admission.reason };
                    }
                }

                qpm.registerActive(userId);

                try {
                    await syncService.runProviderSync(userId, password, forceFullSync);
                    logger.info(`[InlineWorker] Job ${job.id} completed for ${userId}`);
                    span.setStatus({ code: 1 }); // Ok

                    try {
                        const bc = getBC();
                        if (bc) {
                            bc.trackSyncCompleted(forceFullSync ? 'full' : 'incremental').catch(() => {});
                            if (bc.syncDurationHistogram) {
                                bc.syncDurationHistogram.labels(forceFullSync ? 'full' : 'incremental').observe((Date.now() - startTime) / 1000);
                            }
                        }
                    } catch (_) {}

                    return { success: true, userId, jobId: job.id, timestamp: new Date().toISOString() };

                } catch (err) {
                    span.recordException(err);
                    span.setStatus({ code: 2, message: err.message }); // Error

                    try {
                        const bc = getBC();
                        if (bc) {
                            if (bc.syncFailedCounter) bc.syncFailedCounter.labels(forceFullSync ? 'full' : 'incremental').inc();
                            const retryCount = job.attemptsMade || 0;
                            if (retryCount > 0 && bc.syncRetryCounter) {
                                bc.syncRetryCounter.labels(err.name || 'unknown').inc();
                            }
                        }
                    } catch (_) {}

                    try {
                        const ar = getAR();
                        if (ar) ar.routeAlert({
                            service: 'InlineWorker',
                            type:    'scraping_failure',
                            severity: (job.attemptsMade || 0) >= 2 ? 'P1' : 'P2',
                            message: `Sync job ${job.id} failed for ${userId}: ${err.message}`,
                            description: err.stack || err.message
                        });
                    } catch (_) {}

                    const strategy = classifier.classify(err, { attempt: (job.attemptsMade || 0) + 1, userId });
                    if (!strategy.retry || classifier.shouldSuppressQueue(strategy.errorType)) {
                        logger.warn(`[InlineWorker] Non-retryable error. Discarding job retries for ${userId}: ${err.message}`);
                        await job.discard();
                    }
                    throw err;
                } finally {
                    qpm.releaseActive(userId);
                    span.end();
                    await workerService.releaseLock(userId);
                    logger.info(`[InlineWorker] Sync lock released for ${userId}`);

                    try {
                        const durationSec = (Date.now() - startTime) / 1000;
                        const metricsService = require('./metricsService');
                        metricsService.metrics.workerJobDuration.observe({ jobType: forceFullSync ? 'full' : 'incremental' }, durationSec);
                        metricsService.metrics.syncDurationSeconds.observe({ syncType: forceFullSync ? 'full' : 'incremental' }, durationSec);
                    } catch (_) {}
                }
            });
        });
    }, {
        connection,
        concurrency: 2,
        limiter: {
            max: 5,
            duration: 10000
        }
    });

    worker.on('active', (job) => {
        logger.info(`[InlineWorker] Job active: ${job.id}`);
    });

    worker.on('completed', (job) => {
        logger.info(`[InlineWorker] Job completed: ${job.id}`);
    });

    worker.on('failed', (job, err) => {
        const jobId = job ? job.id : 'unknown';
        logger.error(`[InlineWorker] Job failed: ${jobId} — ${err.message}`, { 
            tag: 'QUEUE_FAILURE',
            stack: err.stack 
        });
    });

    worker.on('error', (err) => {
        logger.error(`[InlineWorker] Worker error: ${err.message}`, { 
            tag: 'WORKER_CRASH',
            stack: err.stack 
        });
    });

    logger.info(`[InlineWorker] Inline worker listening on queue: sitam-sync (concurrency=2)`);
    return worker;
}

module.exports = { startInlineWorker };
