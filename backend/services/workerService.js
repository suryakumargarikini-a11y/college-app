/**
 * SITAM Smart ERP — Worker Service (BullMQ + Deduplication)
 *
 * Dispatches sync jobs to BullMQ queue with Redis-based distributed locking
 * to guarantee only ONE active sync job exists per student at any time.
 *
 * Deduplication strategy:
 *   1. Stable BullMQ jobId: `sync:${userId}` — BullMQ deduplicates if job already
 *      exists in waiting/delayed state.
 *   2. Redis NX lock: `lock:sync:${userId}` with 120s TTL — prevents races
 *      between concurrent server instances and worker processes.
 *   3. If Redis is offline: graceful in-memory promise fallback.
 */

const { Queue, QueueEvents } = require('bullmq');
const redisService = require('./redisService');
const metricsService = require('./metricsService');
const logger = require('./logger');

const LOCK_TTL_MS = parseInt(process.env.SYNC_LOCK_TTL_MS || '120000', 10); // 2 minutes

class WorkerService {
    constructor() {
        this.syncQueue = null;
        this.queueEvents = null;
        this.queueName = 'sitam-sync';
    }

    /**
     * Initialize BullMQ Queue if Redis is alive.
     */
    init() {
        if (redisService.isAlive()) {
            logger.info('[WorkerService] Redis is alive. Initializing BullMQ Queue...');
            const redisConnection = redisService.client;

            this.syncQueue = new Queue(this.queueName, {
                connection: redisConnection,
                defaultJobOptions: {
                    attempts: 3,
                    backoff: {
                        type: 'exponential',
                        delay: 5000
                    },
                    removeOnComplete: { count: 100 }, // Keep last 100 completed for inspection
                    removeOnFail: { count: 200 },
                }
            });

            this.queueEvents = new QueueEvents(this.queueName, {
                connection: redisConnection
            });

            this.queueEvents.on('completed', ({ jobId }) => {
                metricsService.metrics.bullmqJobsCompletedTotal.inc({ queue: this.queueName });
                metricsService.metrics.bullmqJobsActive.dec({ queue: this.queueName });
                metricsService.increment('queue_jobs_completed_total');
                metricsService.adjustGauge('queue_active_jobs', -1);
                logger.info(`[WorkerService] Job ${jobId} completed.`);
            });

            this.queueEvents.on('failed', ({ jobId, failedReason }) => {
                metricsService.metrics.bullmqJobsFailedTotal.inc({ queue: this.queueName });
                metricsService.metrics.bullmqJobsActive.dec({ queue: this.queueName });
                metricsService.increment('queue_jobs_failed_total');
                metricsService.adjustGauge('queue_active_jobs', -1);
                logger.error(`[WorkerService] Job ${jobId} failed: ${failedReason}`);
            });

            this.queueEvents.on('active', ({ jobId }) => {
                metricsService.metrics.bullmqJobsActive.inc({ queue: this.queueName });
                metricsService.adjustGauge('queue_active_jobs', 1);
                logger.info(`[WorkerService] Job ${jobId} started processing.`);
            });

            logger.info('[WorkerService] BullMQ Queue initialized.');
        } else {
            logger.warn('[WorkerService] Redis offline. BullMQ skipped. Using in-memory fallback.');
        }
    }

    /**
     * Enqueue a sync job with distributed Redis lock deduplication.
     * Returns: { enqueued: true/false, reason: 'queued'|'deduplicated'|'fallback' }
     */
    async enqueueSync(userId, password, forceFullSync = false, requestId = 'unknown') {
        if (!userId) {
            logger.error('[WorkerService] Cannot enqueue sync: userId is undefined.');
            return { enqueued: false, reason: 'invalid' };
        }

        const ctx = logger.getContext();
        const activeRequestId = ctx.requestId || requestId || 'unknown';
        const activeTraceId = ctx.traceId || activeRequestId;
        const activeCorrelationId = ctx.correlationId || activeRequestId;

        // ── Step 1: Try Redis distributed lock ─────────────────────────────────
        if (redisService.isAlive()) {
            const lockKey = `lock:sync:${userId}`;
            try {
                // SET NX PX — set-if-not-exists with millisecond TTL (atomic)
                const acquired = await redisService.client.set(lockKey, activeRequestId, 'NX', 'PX', LOCK_TTL_MS);

                if (!acquired) {
                    // Lock already held — another sync is already running/queued for this student
                    metricsService.increment('sync_deduplicated_total');
                    logger.info(`[WorkerService] Sync DEDUPLICATED for ${userId} — lock already held.`, { requestId: activeRequestId });
                    return { enqueued: false, reason: 'deduplicated' };
                }

                logger.info(`[WorkerService] Distributed lock acquired for ${userId} (TTL: ${LOCK_TTL_MS}ms)`, { requestId: activeRequestId });
            } catch (err) {
                logger.warn(`[WorkerService] Redis lock check failed: ${err.message}. Proceeding without lock.`, { requestId: activeRequestId });
            }
        }

        // Initialize queue if it was not initialized before
        if (!this.syncQueue && redisService.isAlive()) {
            this.init();
        }

        // ── Step 2: Enqueue via BullMQ ─────────────────────────────────────────
        if (this.syncQueue) {
            try {
                logger.info(`[WorkerService] Enqueuing BullMQ sync job for ${userId}...`, { requestId: activeRequestId });

                // Inject OpenTelemetry tracing context into the job data carrier
                const { propagation, context } = require('../telemetry/tracing');
                const tracingCarrier = {};
                propagation.inject(context.active(), tracingCarrier);

                const { traceSpan } = require('../telemetry/tracing');
                let job = null;

                await traceSpan('redis.queue.enqueue', {
                    'messaging.system': 'bullmq',
                    'messaging.destination': 'sitam-sync',
                    'messaging.operation': 'publish',
                    'queue.name': this.queueName,
                    'user.id': userId,
                    'dependency.type': 'cache',
                    'dependency.name': 'redis',
                    'dependency.category': 'distributed_queue',
                    'dependency.criticality': 'medium'
                }, async (span) => {
                    let waitingCount = 0;
                    let activeCount = 0;
                    try {
                        waitingCount = await this.syncQueue.getWaitingCount();
                        activeCount = await this.syncQueue.getActiveCount();
                        span.setAttribute('queue.waiting_jobs', waitingCount);
                        span.setAttribute('queue.active_jobs', activeCount);
                        span.setAttribute('queue.saturation_ratio', activeCount / 2); // Concurrency limit is 2
                    } catch (_) {}

                    // Query SRE Tenant Isolation metrics to determine queue priority
                    let riskScore = 0;
                    try {
                        const sreService = require('./sreService');
                        const quota = await sreService.registerTenantRequest(userId);
                        riskScore = quota.riskScore;
                    } catch (_) {}

                    const jobPriority = riskScore > 0.5 ? 15 : (forceFullSync ? 5 : 1);

                    job = await this.syncQueue.add(
                        `sync-${userId}`,
                        { 
                            userId, 
                            password, 
                            forceFullSync, 
                            requestId: activeRequestId, 
                            traceId: activeTraceId, 
                            correlationId: activeCorrelationId,
                            tracingCarrier
                        },
                        {
                            // Stable jobId: BullMQ will reject duplicate if same ID is already waiting
                            jobId: `sync:${userId}`,
                            priority: jobPriority
                        }
                    );

                    span.setAttribute('messaging.message_id', job.id);
                    span.addEvent('queue_job_enqueued', { jobId: job.id, userId });
                });

                metricsService.increment('queue_jobs_enqueued_total');
                const waitingCount = (await this.syncQueue.getWaitingCount()) || 0;
                metricsService.metrics.bullmqJobsWaiting.set({ queue: this.queueName }, waitingCount);
                metricsService.setGauge('queue_waiting_jobs', waitingCount);
                logger.info(`[WorkerService] Enqueued job: ${job.id} for ${userId}`, { requestId: activeRequestId });
                return { enqueued: true, reason: 'queued', jobId: job.id };
            } catch (err) {
                if (err.message && err.message.includes('already exists')) {
                    // BullMQ deduplication via stable jobId
                    metricsService.increment('sync_deduplicated_total');
                    logger.info(`[WorkerService] Job already exists in queue for ${userId}. Deduplicated.`, { requestId: activeRequestId });
                    return { enqueued: false, reason: 'deduplicated' };
                }
                logger.error(`[WorkerService] BullMQ enqueue failed: ${err.message}. Falling back.`, { requestId: activeRequestId });
            }
        }

        // ── Step 3: In-memory fallback ─────────────────────────────────────────
        logger.info(`[WorkerService] Running in-memory async fallback for ${userId}`, { requestId: activeRequestId });
        this._runLocalFallback(userId, password, forceFullSync, activeRequestId, activeTraceId, activeCorrelationId);
        return { enqueued: true, reason: 'fallback' };
    }

    /**
     * Release the distributed sync lock for a student (called by worker after job completion).
     */
    async releaseLock(userId) {
        if (redisService.isAlive()) {
            try {
                await redisService.client.del(`lock:sync:${userId}`);
                logger.info(`[WorkerService] Released sync lock for ${userId}`);
            } catch (err) {
                logger.warn(`[WorkerService] Failed to release sync lock for ${userId}: ${err.message}`);
            }
        }
    }

    /**
     * Execute sync as a local async promise (no Redis/BullMQ dependency).
     */
    _runLocalFallback(userId, password, forceFullSync, requestId, traceId, correlationId) {
        const syncService = require('./syncService');

        setTimeout(() => {
            const context = {
                requestId,
                traceId,
                correlationId,
                userId
            };

            logger.runWithContext(context, async () => {
                try {
                    await syncService.runProviderSync(userId, password, forceFullSync);
                } catch (err) {
                    logger.error(`[WorkerService] Local fallback sync failed for ${userId}: ${err.message}`);
                }
            });
        }, 0);
    }
}

module.exports = new WorkerService();
