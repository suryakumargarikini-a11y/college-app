# SITAM Smart ERP — Centralized Logging & Loki Aggregation Setup Guide

This guide documents the architecture, configuration, security redaction policies, and operational runbooks for the SITAM Smart ERP centralized logging infrastructure using Grafana Loki and Promtail.

---

## 1. Centralized Logging Architecture

The logging system is built for high-throughput, low-overhead operations using Winston as the structured JSON producer, Promtail as the log shipper, and Loki as the compressed log database.

```
┌─────────────────────────────────┐
│     SITAM Express API Server     │
│   (Winston JSON Daily Rotate)   │
└────────────────┬────────────────┘
                 │
                 │ writes to logs/*.log files
                 ▼
┌─────────────────────────────────┐
│         Promtail Daemon         │
│   - Pipeline Stage: json        │◄────── Reads Docker container logs
│   - Index labels (level, tag)   │        via unix:///var/run/docker.sock
└────────────────┬────────────────┘
                 │
                 │ http/api/v1/push
                 ▼
┌─────────────────────────────────┐
│      Grafana Loki Database      │
│   - TSDB Index & Chunk Store    │
└────────────────┬────────────────┘
                 │
                 │ LogQL queries
                 ▼
┌─────────────────────────────────┐
│     Grafana Log Explorer UI     │
│   - uid: log-explorer           │
└─────────────────────────────────┘
```

---

## 2. Fast Start Deployment

To deploy the centralized logging stack along with the metrics stack, use the Docker Compose configuration from the `backend/` directory:

```bash
# Spin up Prometheus, Grafana, Loki, and Promtail
docker compose -f monitoring/docker-compose.monitoring.yml up -d
```

### Accessing Logs
1. Open Grafana at [http://localhost:3000](http://localhost:3000) (admin/admin).
2. Navigate to the **Loki Log Explorer & Forensics** dashboard (`/dashboards/log-explorer`).
3. Alternatively, click **Explore** in the sidebar, select the **Loki** data source, and query logs using **LogQL** (e.g. `{job="sitam-erp"}`).

---

## 3. Structured Logging Conventions & SRE Index Tags

All logs produced by the application are serialized as structured JSON lines. Promtail parses this JSON and promotes critical keys to indexed Loki labels, allowing sub-millisecond filtering.

### Indexed Labels (Loki)
- `level`: The severity level (`trace`, `debug`, `info`, `warn`, `error`, `fatal`).
- `service`: Service tag (`sitam-backend`, `sitam-worker`).
- `environment`: The execution environment (`production`, `development`).
- `tag`: SRE operational diagnostic event tag (detailed below).
- `jobId`: The active BullMQ background sync job identifier.
- `workerId`: The background daemon thread identifier.

### Standardized SRE Diagnostic Tags (`tag`)
Use these tags to jump to specific failure points in the Log Explorer dashboard:

| SRE Tag | Log Level | Description |
|---|---|---|
| `SECURITY_ALERT` | `warn` | Capture CORS violations, invalid tokens, and failed logins |
| `QUEUE_FAILURE` | `error` | BullMQ background job processing failures |
| `QUEUE_STALL` | `warn` | Jobs locked/stuck in progress exceeding timeout limits |
| `WORKER_CRASH` | `error` | Global worker process runtime errors |
| `DB_FAILURE` | `error` | Database query execution failures or connection issues |
| `DB_LOCK_CONTENTION` | `error` | Postgres deadlock (`P2034`) or write lock timeouts |
| `REDIS_OUTAGE` | `error` | Cache/queue broker connection drops and network closures |
| `REDIS_COMMAND_FAILURE`| `error` | Redis transaction/command execution rejections |
| `REDIS_MEMORY_PRESSURE`| `warn` | Cache storage approaching memory limit (>85% saturation) |
| `ERP_OUTAGE_FAILURE` | `error` | Outage or sync failures detected on the target university website |
| `CIRCUIT_BREAKER_STATE_CHANGE` | `info` / `error` | Circuit breaker flips (e.g. CLOSED ↔ OPEN ↔ HALF-OPEN) |
| `FIREBASE_DELIVERY_FAILURE` | `error` | Failed push notification deliveries to Firebase messaging |
| `FIREBASE_DELIVERY_SUMMARY` | `info` | Aggregated notification success and fail counters |

---

## 4. Distributed Tracing & Request Correlation

Every incoming request generates three trace attributes propagated through the request lifetime via Node's `AsyncLocalStorage`:

1. `requestId`: A unique UUID tracking the HTTP request.
2. `traceId`: W3C trace identifier (compatible with upstream proxies).
3. `correlationId`: Traces the client's end-to-end operation across threads.

### Cross-Service Propagation Flow
When an API request initiates a background synchronization task, the correlation identifiers are automatically passed down the execution chain:
```
[Client Request] ──(traceId/requestId headers)──► [API Express Middleware]
                                                            │
                                                   (log context boundary)
                                                            │
                                              [Worker Queue Enqueue Payload]
                                                            │
                                                  (distributed Redis)
                                                            │
                                                    [BullMQ Worker]
                                                            │
                                              (executes Puppeteer sync)
```
Any log statement written inside the Express controller, the BullMQ job worker, the Puppeteer scraper, the Prisma database model, or the socket notification service **automatically inherits and prints these IDs**.

---

## 5. Security & Automated Redaction

To comply with privacy laws (GDPR, CCPA) and maintain strict security, the logger automatically intercepts and redacts sensitive data before it is written to the host filesystem or shipped to Loki.

### Redacted Fields
Any metadata keys or query parameters matching these values are replaced with `[REDACTED]`:
- `password`, `passwordConfirm`
- `token`, `jwt`, `session`, `sessionId`
- `authorization` headers
- `cookie` headers
- `secret`, `apiKey`, `db_password`

### Log Message Redaction
The logger applies regular expression filters to message strings to catch and scrub raw credentials, e.g.:
`Authorization: Bearer <secret>` becomes `Authorization: Bearer [REDACTED]`

---

## 6. Log Retention & Disk Exhaustion Prevention

To prevent infinite log growth from filling server disks, the following rotation and retention limits are active:

- **Daily Rotation**: Log files are split by date using `winston-daily-rotate-file`.
- **Zipped Archival**: Closed logs from previous days are automatically compressed using gzip (`zippedArchive: true`), reducing disk footprint by up to 90%.
- **Maximum File Size**: Log files rotate immediately if they exceed size limits (Combined: `20MB`, Error: `10MB`).
- **Retention Period**: Rotated log archives are automatically deleted after **14 days** (`maxFiles: '14d'`).
- **Loki Retention**: Loki is configured with a schema retention limit of **7 days** (`reject_old_samples_max_age: 168h`).

---

## 7. Operational Forensic & Debugging Runbook

### Scenario: Investigating a failed student sync job
1. A student reports an issue. Search the logs for their `userId` or their `correlationId` using the Grafana Log Explorer text search field.
2. Extract the matching `traceId` or `correlationId` from the JSON log details.
3. Apply a query filter in Grafana Loki:
   `{job="sitam-erp"} | json | correlationId="<correlationId>"`
4. Review the timeline:
   - Identify the incoming HTTP POST request.
   - Trace the enqueuing log from `WorkerService`.
   - View the worker job startup log (`[SyncWorker] Processing job`).
   - Inspect the Puppeteer browser pool checkout.
   - If the task failed, view the database transaction or circuit breaker logs bearing the identical `correlationId`.
