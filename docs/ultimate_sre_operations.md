# SITAM Smart ERP — Ultimate SRE Operational Playbooks & Runbooks

This manual contains SRE operational procedures, safety boundaries, disaster recovery strategies, and runbooks for the autonomous SITAM ERP platform.

---

## 1. Auto-Remediation Safety & Action Governance

Autonomous remediation workflows are categorised into three safety classes to prevent runaway recovery cascades.

| Remediation Action | Safety Level | Target Component | Description / Safety Boundary |
| :--- | :--- | :--- | :--- |
| `recycleBrowserPool` | **SAFE** | Puppeteer Pool | Restarts all Chromium browser processes. Limit: Max 1 execution per 5 minutes. |
| `throttleQueueConcurrency` | **SAFE** | BullMQ | Reduces job concurrency limits under CPU memory limits. |
| `resetCircuitBreaker` | **GUARDED** | Scraper Breaker | Forces circuit breaker back to CLOSED state if ERP ping responds 200. |
| `reconnectRedis` | **GUARDED** | Cache Pool | Shuts down active Redis pools and reconnects. |
| `globalQueuePurge` | **MANUAL** | BullMQ | Clears all jobs. Requires Quorum Approval of SRE peer nodes. |
| `databaseFailover` | **MANUAL** | PostgreSQL | Promotes read-replica node to Primary database. |

### Manual Override Escalations
If an action requires `MANUAL_APPROVAL`, the SRE Service will create a Proposal in `/api/sre/consensus/propose`.
* Operators must review active incidents in Grafana or the Status Page.
* To override and force execute, submit a POST request to `/api/sre/override` containing:
  ```json
  {
    "action": "executeProposedRemediation",
    "target": "databaseFailover"
  }
  ```

---

## 2. Multi-Tenant Fairness & Isolation Policies

To prevent a single student/tenant from monopolizing browser contexts or overloading database connections:
1. **Tenant Quotas**: Users are constrained to a concurrency limit of 1 active checkout context.
2. **Dynamic Queue Priority**: If a tenant's risk score increases (due to multiple failed scraping login queries), their jobs are demoted to priority `15` (lowest priority) automatically.
3. **Noisy Neighbor Containment**: If CPU load exceeds 85%, requests from high-risk tenants are rejected with HTTP 429 Too Many Requests (Retry-After: 5 seconds).

---

## 3. Incident State Forensics & Forensic Replay

When a critical alert fires, the system automatically saves a versioned JSON state file under `logs/snapshot_<incidentId>.json`.

### Reconstructing Incidents (Timeline Scrubbing)
1. **Locate the Incident ID** from the Alertmanager header or the Status Page.
2. **Request Forensic Timeline Replay**:
   ```bash
   curl -H "x-sre-role: operator" http://localhost:3001/api/sre/incidents/<incidentId>/replay
   ```
3. **Compare Logs and Spans**:
   * Inspect the clickable TraceID inside Grafana Loki log Explorer views.
   * Cross-reference metrics in Tempo to identify the exact service node that suffered degradation.

---

## 4. Disaster Recovery & Geo-Failover Guide

### Scenario A: Redis Cluster Split-Brain / Saturation
1. Check Redis memory pressure: `INFO MEMORY` in Redis CLI.
2. If Redis is unresponsive, the SRE webhook will fire `RedisDisconnectAlert` and trigger `reconnectRedis`.
3. If reconnect fails, backend will activate the **In-Memory local async fallback**, storing cookies and processing queues in-memory.

### Scenario B: Multi-Region Database Replica Promotion (RTO < 30s)
1. If the Primary PostgreSQL database fails, the consensus nodes propose `databaseFailover`.
2. Upon Quorum approval:
   * Promote Postgres replica:
     ```bash
     pg_ctl promote -D /var/lib/postgresql/data
     ```
   * Update EKS/Kubernetes ConfigMap endpoint pointing to the promoted replica address.
   * Recycle backend deployments to pick up new configurations without downtime.
