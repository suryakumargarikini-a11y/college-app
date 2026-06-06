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

// ─── Puppeteer Browser Pool Metrics ──────────────────────────────────────────
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

const syncDurationSeconds = new promClient.Histogram({
    name: 'sync_duration_seconds',
    help: 'Puppeteer sync execution duration in seconds',
    labelNames: ['syncType'], // e.g. 'full', 'partial'
    buckets: [1, 2.5, 5, 7.5, 10, 15, 20, 25, 30, 45, 60] // Scraping buckets (1s to 60s)
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
register.registerMetric(syncDurationSeconds);
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

module.exports = {
    register,
    snapshot,
    increment,
    setGauge,
    adjustGauge,
    observe,
    recordRequest,
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
        syncDurationSeconds,
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
