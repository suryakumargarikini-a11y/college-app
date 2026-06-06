# SITAM Smart ERP — Prometheus Monitoring Setup Guide

This guide documents the architecture, naming conventions, and scraper configuration for the SITAM Smart ERP metrics infrastructure.

---

## 1. Metrics Endpoint Security & Access

The Prometheus metrics endpoint is exposed at:
`GET /api/metrics`

### Network Layer Protection (Production)
In a production cloud deployment (e.g. AWS, GCP, Railway), the `/api/metrics` endpoint **must not be exposed to the public internet**.
- **VPC Configuration**: Block external access to `/api/metrics` using load balancer rules, security groups, or reverse proxy (Nginx/Traefik) configurations. Allow traffic only from the Prometheus scraper's internal IP / VPC CIDR.
- **Bearer Token Authentication**: You can enable token-gating by setting the `METRICS_BEARER_TOKEN` environment variable in your production configuration.
  ```env
  METRICS_BEARER_TOKEN="your-super-secret-token"
  ```
  If set, the scraper must supply the header:
  `Authorization: Bearer your-super-secret-token`

---

## 2. Metrics Inventory & Conventions

All custom metrics follow the Prometheus standard naming convention: `[namespace]_[metric_name]_[unit]`.

| Metric Name | Type | Labels | Description |
|---|---|---|---|
| `http_requests_total` | Counter | `method`, `route`, `status` | Total HTTP requests processed |
| `http_request_duration_seconds` | Histogram | `method`, `route`, `status` | Request latencies in seconds |
| `active_http_requests` | Gauge | `method`, `route` | Concurrent in-flight HTTP requests |
| `http_slow_requests_total` | Counter | `method`, `route`, `status` | Requests exceeding the 500ms threshold |
| `redis_connected` | Gauge | None | Redis state (1 = connected, 0 = offline) |
| `redis_reconnect_total` | Counter | None | Total Redis reconnection events |
| `redis_command_duration_seconds` | Histogram | `command` | ioredis command latency |
| `bullmq_jobs_waiting` | Gauge | `queue` | Jobs waiting in queue |
| `bullmq_jobs_active` | Gauge | `queue` | Jobs in active processing state |
| `bullmq_jobs_failed_total` | Counter | `queue` | Total failed worker jobs |
| `bullmq_jobs_completed_total` | Counter | `queue` | Total completed worker jobs |
| `bullmq_queue_latency_seconds` | Histogram | `queue` | Duration jobs spent waiting in the queue |
| `browser_pool_active_browsers` | Gauge | None | Number of running browser instances |
| `browser_pool_active_contexts` | Gauge | None | Active incognito checkout contexts |
| `browser_crashes_total` | Counter | None | Unexpected browser process exit count |
| `browser_pool_recycle_total` | Counter | None | Browser instances recycled due to idle |
| `browser_pool_timeouts_total` | Counter | None | Checkout request timeouts |
| `sync_duration_seconds` | Histogram | `syncType` | Scraping job execution timings |
| `postgres_pool_active_connections` | Gauge | None | In-flight Prisma queries |
| `postgres_query_duration_seconds` | Histogram | None | SQL execution latency |
| `postgres_slow_queries_total` | Counter | None | Total SQL queries >200ms |
| `websocket_connections_active` | Gauge | None | Active WS sessions |
| `websocket_messages_total` | Counter | `direction` | inbound/outbound WS message count |
| `circuit_breaker_state` | Gauge | `breaker` | ERP Breaker state (0=Closed, 0.5=Half-open, 1=Open) |
| `circuit_breaker_failures_total` | Counter | `breaker` | Failures counted by circuit |
| `workers_active` | Gauge | `worker` | Worker process presence status |
| `worker_job_duration_seconds` | Histogram | `jobType` | Background job execution times |

### Cardinality Protection Rules
- **Do not include user IDs, session tokens, or dates in metrics labels**.
- Routes are normalized by the API middleware (e.g. `/api/student/25B61A0596` maps to `/api/student/:id`) before recording, protecting the Prometheus server from memory bloating.

---

## 3. Prometheus Scraper Configuration

To configure your Prometheus instance to scrape metrics from the backend, add the following to `prometheus.yml`:

```yaml
global:
  scrape_interval: 15s # Set scrape interval to 15 seconds
  evaluation_interval: 15s

scrape_configs:
  - job_name: 'sitam-erp-backend'
    metrics_path: '/api/metrics'
    static_configs:
      - targets: ['localhost:3001'] # Target backend host
    
    # If token-gating is enabled (optional)
    # authorization:
    #   credentials: 'your-super-secret-token'
```

---

## 4. Verification

To verify that the metrics endpoint is producing correctly formatted exposition lines, execute the included SRE test script:

```bash
# Verify metrics on a running backend
node scripts/verify-metrics.js
```
