/**
 * SITAM Smart ERP — Enterprise Prometheus Metrics Service
 *
 * Implements prom-client registry, collecting default Node.js process metrics
 * and managing all custom metrics for APIs, Redis, BullMQ, Puppeteer,
 * PostgreSQL, WebSockets, Circuit Breakers, and Workers.
 */

const promClient = require('prom-client');
const logger = require('./logger');

// Create a Registry
const register = new promClient.Registry();

// Add default Node.js metrics (CPU, RAM, Event Loop, Garbage Collection)
promClient.collectDefaultMetrics({ register, prefix: 'node_' });

// ─── API Metrics ─────────────────────────────────────────────────────────────
const httpRequestsTotal = new promClient.Counter({
    name: 'http_requests_total',
    help: 'Total number of HTTP requests processed',
    labelNames: ['method', 'route', 'status'],
});

const httpRequestDuration = new promClient.Histogram({
    name: 'http_request_duration_seconds',
    help: 'Duration of HTTP requests in seconds',
    labelNames: ['method', 'route', 'status'],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30] // Buckets from 5ms to 30s
});

const activeHttpRequests = new promClient.Gauge({
    name: 'active_http_requests',
    help: 'Number of active HTTP requests currently in-flight',
    labelNames: ['method', 'route'],
});

const httpSlowRequestsTotal = new promClient.Counter({
    name: 'http_slow_requests_total',
    help: 'Total HTTP requests exceeding the 500ms slow response threshold',
    labelNames: ['method', 'route', 'status'],
});

// ─── Redis Metrics ───────────────────────────────────────────────────────────
const redisConnected = new promClient.Gauge({
    name: 'redis_connected',
    help: 'Redis connection state (1 for connected, 0 for disconnected)',
});

const redisReconnectTotal = new promClient.Counter({
    name: 'redis_reconnect_total',
    help: 'Total Redis reconnection attempts',
});

const redisCommandDuration = new promClient.Histogram({
    name: 'redis_command_duration_seconds',
    help: 'Duration of Redis commands in seconds',
    labelNames: ['command'],
    buckets: [0.001, 0.002, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5] // Buckets from 1ms to 500ms
});

// ─── BullMQ Queue Metrics ────────────────────────────────────────────────────
const bullmqJobsWaiting = new promClient.Gauge({
    name: 'bullmq_jobs_waiting',
    help: 'Number of BullMQ jobs currently waiting in the queue',
    labelNames: ['queue'],
});

const bullmqJobsActive = new promClient.Gauge({
    name: 'bullmq_jobs_active',
    help: 'Number of active BullMQ jobs currently being processed',
    labelNames: ['queue'],
});

const bullmqJobsFailedTotal = new promClient.Counter({
    name: 'bullmq_jobs_failed_total',
    help: 'Total number of failed BullMQ jobs',
    labelNames: ['queue'],
});

const bullmqJobsCompletedTotal = new promClient.Counter({
    name: 'bullmq_jobs_completed_total',
    help: 'Total number of completed BullMQ jobs',
    labelNames: ['queue'],
});

const bullmqQueueLatency = new promClient.Histogram({
    name: 'bullmq_queue_latency_seconds',
    help: 'Time spent in the queue before processing (in seconds)',
    labelNames: ['queue'],
    buckets: [0.1, 0.5, 1, 2.5, 5, 10, 30, 60, 120] // From 100ms to 2 minutes
});

// ─── Browser Automation Metrics ──────────────────────────────────────────────
// (covers both Puppeteer and Playwright — labelled by provider)
const browserPoolActiveBrowsers = new promClient.Gauge({
    name: 'browser_pool_active_browsers',
    help: 'Number of active Chromium browser instances running in the pool',
});

const browserPoolActiveContexts = new promClient.Gauge({
    name: 'browser_pool_active_contexts',
    help: 'Number of active incognito browser contexts checked out',
});

const browserCrashesTotal = new promClient.Counter({
    name: 'browser_crashes_total',
    help: 'Total number of Chromium browser process crashes',
});

const browserPoolRecycleTotal = new promClient.Counter({
    name: 'browser_pool_recycle_total',
    help: 'Total number of browser instances recycled due to idle timeout',
});

const browserPoolTimeoutsTotal = new promClient.Counter({
    name: 'browser_pool_timeouts_total',
    help: 'Total number of browser pool checkout timeouts',
});

// ─── Dual-Pool Labeled Gauges (AUTH_POOL / SYNC_POOL) ────────────────────────
// These complement the above unlabelled gauges with per-pool resolution.
// Label values: pool='auth' | pool='sync'
const browserPoolBrowsersByPool = new promClient.Gauge({
    name: 'browser_pool_browsers_by_pool',
    help: 'Number of non-retired Chromium browsers per pool',
    labelNames: ['pool'],
});

const browserPoolActiveByPool = new promClient.Gauge({
    name: 'browser_pool_active_by_pool',
    help: 'Number of browsers actively serving a job per pool',
    labelNames: ['pool'],
});

const browserPoolQueueDepthByPool = new promClient.Gauge({
    name: 'browser_pool_queue_depth_by_pool',
    help: 'Current number of requests waiting in the priority queue per pool',
    labelNames: ['pool'],
});

const browserPoolAvgWaitMsByPool = new promClient.Gauge({
    name: 'browser_pool_avg_wait_ms_by_pool',
    help: 'Exponential moving average of browser acquire wait time per pool (ms)',
    labelNames: ['pool'],
});

const syncDurationSeconds = new promClient.Histogram({
    name: 'sync_duration_seconds',
    help: 'ERP sync execution duration in seconds',
    labelNames: ['syncType', 'provider'],
    buckets: [1, 2.5, 5, 7.5, 10, 15, 20, 25, 30, 45, 60]
});

// ─── New: Per-provider + per-stage browser metrics ───────────────────────────

/** Time to launch a browser process (cold start) */
const browserLaunchDurationSeconds = new promClient.Histogram({
    name: 'browser_launch_duration_seconds',
    help: 'Time to launch a browser process',
    labelNames: ['provider'],
    buckets: [0.5, 1, 2, 3, 5, 8, 12],
});

/** End-to-end ERP login duration (from first goto to session ready) */
const loginDurationSeconds = new promClient.Histogram({
    name: 'login_duration_seconds',
    help: 'End-to-end ERP login duration',
    labelNames: ['result', 'provider'],
    buckets: [2, 5, 10, 15, 20, 30, 45, 60],
});

/** Individual scrape stage durations (profile, marks, fees, etc.) */
const scrapeStageDurationSeconds = new promClient.Histogram({
    name: 'scrape_stage_duration_seconds',
    help: 'Duration of individual ERP scrape stages',
    labelNames: ['stage', 'provider'],
    buckets: [1, 2.5, 5, 10, 15, 20, 30, 45, 60],
});

/** Page goto retry counter (per page, per provider) */
const pageRetryTotal = new promClient.Counter({
    name: 'page_retry_total',
    help: 'Total page goto retries',
    labelNames: ['page', 'provider'],
});

/** Node.js RSS memory snapshot at end of each sync job */
const syncMemoryRssMb = new promClient.Gauge({
    name: 'sync_memory_rss_mb',
    help: 'Node.js RSS memory in MB at the end of each sync job',
    labelNames: ['provider'],
});

/** Context isolation violations — cookie leaks detected between students */
const isolationViolationsTotal = new promClient.Counter({
    name: 'isolation_violations_total',
    help: 'Context isolation violations (leaked cookies between student sessions)',
    labelNames: ['stage'],  // 'checkout' | 'checkin'
});

/** Browser crashes labelled by provider for Puppeteer vs Playwright comparison */
const browserCrashesByProvider = new promClient.Counter({
    name: 'browser_crashes_by_provider',
    help: 'Browser crashes broken down by automation provider',
    labelNames: ['provider'],
});


// ─── PostgreSQL Metrics ──────────────────────────────────────────────────────
const postgresPoolActiveConnections = new promClient.Gauge({
    name: 'postgres_pool_active_connections',
    help: 'Number of active PostgreSQL client connections in-flight',
});

const postgresQueryDuration = new promClient.Histogram({
    name: 'postgres_query_duration_seconds',
    help: 'PostgreSQL query execution duration in seconds',
    buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.2, 0.5, 1, 2.5] // From 1ms to 2.5s
});

const postgresSlowQueriesTotal = new promClient.Counter({
    name: 'postgres_slow_queries_total',
    help: 'Total number of slow PostgreSQL queries exceeding threshold',
});

// ─── WebSocket Metrics ───────────────────────────────────────────────────────
const websocketConnectionsActive = new promClient.Gauge({
    name: 'websocket_connections_active',
    help: 'Number of active client WebSocket connections',
});

const websocketMessagesTotal = new promClient.Counter({
    name: 'websocket_messages_total',
    help: 'Total number of WebSocket messages processed',
    labelNames: ['direction'], // 'inbound' or 'outbound'
});

// ─── Circuit Breaker Metrics ─────────────────────────────────────────────────
const circuitBreakerState = new promClient.Gauge({
    name: 'circuit_breaker_state',
    help: 'Current state of the circuit breaker (0 = CLOSED, 0.5 = HALF_OPEN, 1 = OPEN)',
    labelNames: ['breaker'],
});

const circuitBreakerFailuresTotal = new promClient.Counter({
    name: 'circuit_breaker_failures_total',
    help: 'Total failed requests contributing to circuit breaker limit',
    labelNames: ['breaker'],
});

// ─── Worker Metrics ──────────────────────────────────────────────────────────
const workersActive = new promClient.Gauge({
    name: 'workers_active',
    help: 'Active worker execution status',
    labelNames: ['worker'],
});

const workerJobDuration = new promClient.Histogram({
    name: 'worker_job_duration_seconds',
    help: 'Uptime processing durations for background worker tasks',
    labelNames: ['jobType'],
    buckets: [0.1, 0.5, 1, 2.5, 5, 10, 15, 20, 25, 30, 45, 60]
});

// Register all custom metrics
register.registerMetric(httpRequestsTotal);
register.registerMetric(httpRequestDuration);
register.registerMetric(activeHttpRequests);
register.registerMetric(httpSlowRequestsTotal);
register.registerMetric(redisConnected);
register.registerMetric(redisReconnectTotal);
register.registerMetric(redisCommandDuration);
register.registerMetric(bullmqJobsWaiting);
register.registerMetric(bullmqJobsActive);
register.registerMetric(bullmqJobsFailedTotal);
register.registerMetric(bullmqJobsCompletedTotal);
register.registerMetric(bullmqQueueLatency);
register.registerMetric(browserPoolActiveBrowsers);
register.registerMetric(browserPoolActiveContexts);
register.registerMetric(browserCrashesTotal);
register.registerMetric(browserPoolRecycleTotal);
register.registerMetric(browserPoolTimeoutsTotal);
register.registerMetric(browserPoolBrowsersByPool);
register.registerMetric(browserPoolActiveByPool);
register.registerMetric(browserPoolQueueDepthByPool);
register.registerMetric(browserPoolAvgWaitMsByPool);
register.registerMetric(syncDurationSeconds);
register.registerMetric(browserLaunchDurationSeconds);
register.registerMetric(loginDurationSeconds);
register.registerMetric(scrapeStageDurationSeconds);
register.registerMetric(pageRetryTotal);
register.registerMetric(syncMemoryRssMb);
register.registerMetric(isolationViolationsTotal);
register.registerMetric(browserCrashesByProvider);
register.registerMetric(postgresPoolActiveConnections);
register.registerMetric(postgresQueryDuration);
register.registerMetric(postgresSlowQueriesTotal);
register.registerMetric(websocketConnectionsActive);
register.registerMetric(websocketMessagesTotal);
register.registerMetric(circuitBreakerState);
register.registerMetric(circuitBreakerFailuresTotal);
register.registerMetric(workersActive);
register.registerMetric(workerJobDuration);

// Initialize default metric states
redisConnected.set(0);

logger.info('[Metrics] Enterprise Prometheus registry initialized successfully.');

async function snapshot() {
    const summary = {};
    try {
        const rawMetrics = await register.getMetricsAsJSON();
        for (const item of rawMetrics) {
            if (item.type === 'counter' || item.type === 'gauge') {
                if (item.values.length === 1 && Object.keys(item.values[0].labels).length === 0) {
                    summary[item.name] = item.values[0].value;
                } else if (item.values.length > 0) {
                    summary[item.name] = {};
                    for (const val of item.values) {
                        const labelValues = Object.values(val.labels);
                        const labelStr = labelValues.length > 0 ? labelValues.join('_') : 'total';
                        summary[item.name][labelStr] = val.value;
                    }
                } else {
                    summary[item.name] = 0;
                }
            }
        }
    } catch (err) {
        logger.error(`[Metrics] Error generating snapshot: ${err.message}`);
    }
    return summary;
}

// Proxy compatibility methods
function increment(name, label = null, amount = 1) {
    // Maps legacy counters to prom-client objects
    const mapping = {
        api_requests_total: httpRequestsTotal,
        queue_jobs_enqueued_total: bullmqJobsWaiting,
        queue_jobs_completed_total: bullmqJobsCompletedTotal,
        queue_jobs_failed_total: bullmqJobsFailedTotal,
    };

    const target = mapping[name] || httpRequestsTotal;
    if (target) {
        try {
            if (label) {
                if (typeof label === 'string') {
                    if (target.labelNames && target.labelNames.length > 0) {
                        const labelsObj = {};
                        labelsObj[target.labelNames[0]] = label;
                        target.inc(labelsObj, amount);
                    } else {
                        target.inc(amount);
                    }
                } else {
                    target.inc(label, amount);
                }
            } else {
                target.inc(amount);
            }
        } catch (err) {
            // Ignore format errors silently
        }
    }
}

function setGauge(name, value) {
    const mapping = {
        browser_pool_active: browserPoolActiveBrowsers,
        websocket_connections_active: websocketConnectionsActive,
        queue_waiting_jobs: bullmqJobsWaiting,
        queue_active_jobs: bullmqJobsActive
    };

    const target = mapping[name];
    if (target) {
        try {
            target.set(value);
        } catch (_) {}
    }
}

function adjustGauge(name, delta) {
    const mapping = {
        browser_pool_active: browserPoolActiveBrowsers,
        websocket_connections_active: websocketConnectionsActive,
        queue_waiting_jobs: bullmqJobsWaiting,
        queue_active_jobs: bullmqJobsActive
    };

    const target = mapping[name];
    if (target) {
        try {
            target.inc(delta);
        } catch (_) {}
    }
}

function observe(name, label, value) {
    if (name === 'api_request_duration_ms') {
        const routeLabel = label ? label.replace(/[^a-zA-Z0-9_./ :]/g, '_') : 'unknown';
        httpRequestDuration.observe({ route: routeLabel }, value / 1000);
    }
}

function recordRequest(method, route, status, durationMs) {
    const routeLabel = route ? route.replace(/[^a-zA-Z0-9_./ :]/g, '_') : '/';
    const statusStr = String(status);
    
    httpRequestsTotal.inc({ method, route: routeLabel, status: statusStr });
    httpRequestDuration.observe({ method, route: routeLabel, status: statusStr }, durationMs / 1000);
    
    if (durationMs > 500) {
        httpSlowRequestsTotal.inc({ method, route: routeLabel, status: statusStr });
    }
}

/**
 * getSloStats — translate live Prometheus counters into SLO compliance data.
 *
 * Called every 30s by ObservabilityScheduler to feed real metric values into
 * SLOFramework.calculateBudgets(). Returns a map keyed by SLO name with
 * { success, total } pairs. Missing or zero-total SLOs fall back to the
 * registry's stored historical values (handled inside SLOFramework).
 *
 * @returns {Record<string, { success: number, total: number }>}
 */
async function getSloStats() {
    const stats = {};
    try {
        const rawMetrics = await register.getMetricsAsJSON();
        const metricMap = {};
        for (const m of rawMetrics) {
            metricMap[m.name] = m;
        }

        // ── api_success_rate ─────────────────────────────────────────────────
        const httpMetric = metricMap['http_requests_total'];
        if (httpMetric) {
            let success = 0;
            let total = 0;
            for (const v of httpMetric.values) {
                const code = parseInt(v.labels.status, 10);
                if (!isNaN(code)) {
                    total += v.value;
                    if (code < 500) success += v.value;
                }
            }
            if (total > 0) stats['api_success_rate'] = { success, total };
        }

        // ── sync_success_rate ────────────────────────────────────────────────
        const completedMetric = metricMap['bullmq_jobs_completed_total'];
        const failedMetric    = metricMap['bullmq_jobs_failed_total'];
        const completed = completedMetric ? (completedMetric.values[0] || {}).value || 0 : 0;
        const failed    = failedMetric    ? (failedMetric.values[0]    || {}).value || 0 : 0;
        const syncTotal = completed + failed;
        if (syncTotal > 0) {
            stats['sync_success_rate'] = { success: completed, total: syncTotal };
            stats['queue_processing_rate'] = { success: completed, total: syncTotal };
        }
    } catch (err) {
        logger.warn(`[Metrics] getSloStats error: ${err.message}`);
    }
    return stats;
}

module.exports = {
    register,
    snapshot,
    increment,
    setGauge,
    adjustGauge,
    observe,
    recordRequest,
    getSloStats,
    metrics: {
        httpRequestsTotal,
        httpRequestDuration,
        activeHttpRequests,
        httpSlowRequestsTotal,
        redisConnected,
        redisReconnectTotal,
        redisCommandDuration,
        bullmqJobsWaiting,
        bullmqJobsActive,
        bullmqJobsFailedTotal,
        bullmqJobsCompletedTotal,
        bullmqQueueLatency,
        browserPoolActiveBrowsers,
        browserPoolActiveContexts,
        browserCrashesTotal,
        browserPoolRecycleTotal,
        browserPoolTimeoutsTotal,
        browserPoolBrowsersByPool,
        browserPoolActiveByPool,
        browserPoolQueueDepthByPool,
        browserPoolAvgWaitMsByPool,
        syncDurationSeconds,
        // New browser automation metrics
        browserLaunchDurationSeconds,
        loginDurationSeconds,
        scrapeStageDurationSeconds,
        pageRetryTotal,
        syncMemoryRssMb,
        isolationViolationsTotal,
        browserCrashesByProvider,
        // Existing DB/infra metrics
        postgresPoolActiveConnections,
        postgresQueryDuration,
        postgresSlowQueriesTotal,
        websocketConnectionsActive,
        websocketMessagesTotal,
        circuitBreakerState,
        circuitBreakerFailuresTotal,
        workersActive,
        workerJobDuration,
    }
};
