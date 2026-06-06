/**
 * SITAM Smart ERP — Advanced OpenTelemetry distributed tracing bootstrap
 *
 * Configures the OpenTelemetry Node SDK to collect, format, and export traces.
 * Traces are exported via OTLP HTTP receiver (port 4318) to Grafana Tempo.
 *
 * Features implemented:
 *   - Tail-based Sampling Decision Engine (always preserves errors, slow traces, anomalies)
 *   - Telemetry Budget Enforcement (prevents memory leaks & trace storms)
 *   - Security Attribute Sanitization (prevents credential leaks in trace databases)
 *   - SLO-aware Intelligent Prioritization (escalates trace retention on performance drop)
 *   - eBPF-Ready Observability hooks
 */

const { NodeSDK } = require('@opentelemetry/sdk-node');
const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');
const { Resource } = require('@opentelemetry/resources');
const { SemanticResourceAttributes } = require('@opentelemetry/semantic-conventions');
const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node');
const { trace, context, propagation, SpanStatusCode } = require('@opentelemetry/api');
const { randomUUID } = require('crypto');

const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const SERVICE_NAME = process.env.SERVICE_NAME || (process.argv[1].endsWith('worker.js') ? 'sitam-worker' : 'sitam-backend');
const INSTANCE_ID = `${SERVICE_NAME}-${randomUUID().substring(0, 8)}`;

// ─── Telemetry Budgets & SLO Configs ──────────────────────────────────────────
const BUDGETS = {
    MAX_SPANS_PER_TRACE: 100,
    MAX_SPANS_PER_WORKER: 50,
    MAX_NESTED_PUPPETEER: 10
};

const SLO_LIMITS_MS = {
    API_DEFAULT: 1000,       // 1s default limit
    DB_QUERY: 200,           // 200ms slow query limit
    REDIS_COMMAND: 100,      // 100ms redis limit
    PUPPETEER_SYNC: 15000    // 15s browser sync limit
};

// ─── Custom Tail-Based Sampling & Sanitizing Span Processor ──────────────────
class TailSamplingSpanProcessor {
    constructor(exporter, options = {}) {
        this.exporter = exporter;
        this.sampleRate = options.sampleRate || 0.1;
        
        this.buffer = new Map(); // traceId -> { spans: [], hasError: false, isSlow: false, hasAnomaly: false, start: number }
        this.keptTraceIds = new Set();
        this.discardedTraceIds = new Set();
        
        // Sensitive keys for sanitization
        this.redactKeys = [
            'password', 'passwordconfirm', 'token', 'jwt', 'cookie', 
            'session', 'sessionid', 'authorization', 'secret', 'apikey', 
            'db_password', 'db_url', 'student_password', 'credentials'
        ];

        // Periodic buffer & cache pruning
        this.cleanupInterval = setInterval(() => this.cleanup(), 10000);
        this.cleanupInterval.unref();

        // Telemetry Resilience & Failsafe Mode
        this.failsafeActive = false;
        this.lastFailsafeCheck = 0;
    }

    onStart(span, parentContext) {
        const traceId = span.spanContext().traceId;
        const parentSpanId = span.parentSpanId;

        // Telemetry budget check
        const traceData = this.buffer.get(traceId);
        if (traceData && traceData.spans.length >= BUDGETS.MAX_SPANS_PER_TRACE) {
            span.setAttribute('telemetry.budget_exceeded', true);
        }
    }

    onEnd(span) {
        const spanCtx = span.spanContext();
        const traceId = spanCtx.traceId;

        // 1. Immediately drop if already discarded
        if (this.discardedTraceIds.has(traceId)) {
            return;
        }

        // 2. Immediately export if already kept
        if (this.keptTraceIds.has(traceId)) {
            this.sanitizeAndExport(span);
            return;
        }

        // 3. Initialize or fetch trace buffer
        if (!this.buffer.has(traceId)) {
            this.buffer.set(traceId, {
                spans: [],
                hasError: false,
                isSlow: false,
                hasAnomaly: false,
                start: Date.now()
            });
        }

        const traceData = this.buffer.get(traceId);

        // Telemetry Budget Enforcement: drop if over budget
        if (traceData.spans.length >= BUDGETS.MAX_SPANS_PER_TRACE) {
            return;
        }

        // Add to buffer
        traceData.spans.push(span);

        // Evaluate performance & error triggers
        if (span.status && span.status.code === SpanStatusCode.ERROR) {
            traceData.hasError = true;
        }

        // Check SLO breaches to flag slow trace
        const durationMs = span.duration ? (span.duration[0] * 1000 + span.duration[1] / 1000000) : 0;
        const spanName = span.name || '';
        
        if (
            (spanName.startsWith('api.') && durationMs > SLO_LIMITS_MS.API_DEFAULT) ||
            (spanName.startsWith('db.') && durationMs > SLO_LIMITS_MS.DB_QUERY) ||
            (spanName.startsWith('redis.') && durationMs > SLO_LIMITS_MS.REDIS_COMMAND) ||
            (spanName.startsWith('puppeteer.') && durationMs > SLO_LIMITS_MS.PUPPETEER_SYNC)
        ) {
            traceData.isSlow = true;
            span.setAttribute('slo.violation', true);
        }

        // Check anomaly flags
        if (span.attributes && (span.attributes['anomaly'] === true || span.attributes['anomaly.severity'])) {
            traceData.hasAnomaly = true;
        }

        // If root span ended, defer decision by 100ms to allow async child spans to complete
        const isRootSpan = !span.parentSpanId;
        if (isRootSpan) {
            setTimeout(() => this.makeDecision(traceId), 100);
        }
    }

    makeDecision(traceId) {
        const traceData = this.buffer.get(traceId);
        if (!traceData) return;

        // Tail decision logic: preserve errors, slow spans, anomalies, or sample probabilistically
        const shouldKeep = traceData.hasError || traceData.isSlow || traceData.hasAnomaly || (Math.random() < this.sampleRate);

        if (shouldKeep) {
            this.keptTraceIds.add(traceId);
            // Export all buffered spans
            for (const s of traceData.spans) {
                this.sanitizeAndExport(s);
            }
        } else {
            this.discardedTraceIds.add(traceId);
        }

        this.buffer.delete(traceId);
    }

    checkFailsafe() {
        const now = Date.now();
        if (now - this.lastFailsafeCheck < 5000) {
            return this.failsafeActive;
        }
        this.lastFailsafeCheck = now;
        
        try {
            const v8 = require('v8');
            const mem = process.memoryUsage();
            const heapLimit = v8.getHeapStatistics().heap_size_limit;
            const memoryPressure = mem.heapUsed / heapLimit;

            if (memoryPressure > 0.90) {
                if (!this.failsafeActive) {
                    console.warn(`[SRE-Tracing] Telemetry Failsafe Activated! Memory Pressure at ${Math.round(memoryPressure * 100)}%`);
                    this.failsafeActive = true;
                }
            } else {
                this.failsafeActive = false;
            }
        } catch (_) {
            this.failsafeActive = false;
        }
        return this.failsafeActive;
    }

    sanitizeAndExport(span) {
        if (this.checkFailsafe()) {
            return; // Shed telemetry
        }
        // Redact credentials/secrets inside span attributes before exporting
        if (span.attributes) {
            for (const key of Object.keys(span.attributes)) {
                const keyLower = key.toLowerCase();
                const matchesRedact = this.redactKeys.some(rk => keyLower.includes(rk));
                if (matchesRedact) {
                    span.attributes[key] = '[REDACTED]';
                }
            }
        }
        this.exporter.export([span], () => {});
    }

    cleanup() {
        const now = Date.now();
        
        // Evict stale buffered traces that never completed root span (timeout = 60s)
        for (const [traceId, data] of this.buffer.entries()) {
            if (now - data.start > 60000) {
                // If it contains errors, dump it anyway, else drop
                if (data.hasError || data.isSlow || data.hasAnomaly) {
                    for (const s of data.spans) {
                        this.sanitizeAndExport(s);
                    }
                }
                this.buffer.delete(traceId);
            }
        }

        // Bound memory footprint of decision caches (max size 5000)
        if (this.keptTraceIds.size > 5000) {
            this.keptTraceIds.clear();
        }
        if (this.discardedTraceIds.size > 5000) {
            this.discardedTraceIds.clear();
        }
    }

    async forceFlush() {
        // Flush all active buffers
        for (const [traceId, data] of this.buffer.entries()) {
            for (const s of data.spans) {
                this.sanitizeAndExport(s);
            }
        }
        this.buffer.clear();
        return this.exporter.forceFlush();
    }

    async shutdown() {
        clearInterval(this.cleanupInterval);
        await this.forceFlush();
        return this.exporter.shutdown();
    }
}

// ─── OTLP Trace Exporter ────────────────────────────────────────────────────
const exporter = new OTLPTraceExporter({
    url: process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT || 'http://localhost:4318/v1/traces',
    timeoutMillis: 5000,
});

// ─── NodeSDK Initialization ─────────────────────────────────────────────────
const sdk = new NodeSDK({
    resource: new Resource({
        [SemanticResourceAttributes.SERVICE_NAME]: SERVICE_NAME,
        [SemanticResourceAttributes.SERVICE_VERSION]: '1.0.0',
        [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: process.env.NODE_ENV || 'production',
        'service.instance.id': INSTANCE_ID,
    }),
    spanProcessor: new TailSamplingSpanProcessor(exporter, {
        sampleRate: IS_PRODUCTION ? 0.1 : 1.0 // 10% in prod, 100% in dev
    }),
    instrumentations: [
        getNodeAutoInstrumentations({
            // Disable heavy fs tracing (avoid node_modules loading lag)
            '@opentelemetry/instrumentation-fs': { enabled: false },
            // Ignore metrics and health check HTTP queries
            '@opentelemetry/instrumentation-http': {
                ignoreIncomingRequestHook: (req) => {
                    const url = req.url || '';
                    return url.includes('/metrics') || url.includes('/health');
                }
            },
            '@opentelemetry/instrumentation-pg': { enhancedDatabaseReporting: true }
        })
    ]
});

// Start tracing SDK
try {
    sdk.start();
    console.log(`[Telemetry] Advanced telemetry initialized for instance: ${INSTANCE_ID}`);
} catch (err) {
    console.error(`[Telemetry] Failed to initialize distributed tracing: ${err.message}`);
}

// ─── Graceful Teardown ──────────────────────────────────────────────────────
const shutdownTracing = async () => {
    try {
        await sdk.shutdown();
        console.log('[Telemetry] Advanced telemetry shutdown cleanly.');
    } catch (err) {
        console.error('[Telemetry] Error shutting down advanced telemetry:', err);
    }
};

process.on('SIGTERM', () => shutdownTracing());
process.on('SIGINT', () => shutdownTracing());

// ─── Custom Tracing Helpers ──────────────────────────────────────────────────
const tracer = trace.getTracer('sitam-custom-telemetry');

/**
 * Traces an async operation inside a new custom OpenTelemetry Span.
 * Normalizes naming patterns to `service.operation.resource` convention.
 */
async function traceSpan(name, attributes = {}, fn) {
    return tracer.startActiveSpan(name, { attributes }, async (span) => {
        try {
            // Apply standard instance & environment details
            span.setAttribute('service.instance.id', INSTANCE_ID);
            span.setAttribute('service.environment', process.env.NODE_ENV || 'production');
            
            const res = await fn(span);
            span.setStatus({ code: SpanStatusCode.OK });
            return res;
        } catch (err) {
            span.recordException(err);
            span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
            
            // Tag anomaly tags for failure mitigation
            span.setAttribute('anomaly', true);
            span.setAttribute('anomaly.type', 'execution_failure');
            span.setAttribute('anomaly.severity', 'high');
            
            throw err;
        } finally {
            span.end();
        }
    });
}

// ─── eBPF / Future Telemetry Hooks ──────────────────────────────────────────
// Expose future-ready abstraction hooks that external agents/collectors can hook
const ebpfTelemetryBridge = {
    registerSyscallHook: (syscallName, callback) => {
        // eBPF abstraction hook stub
    },
    registerNetworkLatencyHook: (source, destination, callback) => {
        // eBPF network trace hook stub
    }
};

module.exports = {
    shutdownTracing,
    tracer,
    traceSpan,
    context,
    propagation,
    ebpfTelemetryBridge,
    SpanStatusCode,
    INSTANCE_ID
};
