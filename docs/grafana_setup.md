# SITAM Smart ERP — Enterprise Grafana Observability Guide

This guide documents the setup, architecture, security, and operational usage of the Grafana dashboard stack for the SITAM Smart ERP distributed infrastructure.

---

## 1. Monitoring Stack Architecture

The monitoring infrastructure operates as a decoupled Dockerized stack using Prometheus to scrape metrics from the SITAM ERP application and Grafana to visualize them in real time.

```
                  ┌───────────────────────────────┐
                  │      SITAM ERP Application    │
                  │   Host/Container Port 3001    │
                  └──────────────┬────────────────┘
                                 │
                        /api/metrics (15s scrape interval)
                                 │
                  ┌──────────────▼────────────────┐
                  │       Prometheus Server       │
                  │   Host/Container Port 9090    │
                  └──────────────┬────────────────┘
                                 │
                        PromQL Data Source
                                 │
                  ┌──────────────▼────────────────┐
                  │       Grafana Dashboards      │
                  │   Host/Container Port 3000    │
                  └───────────────────────────────┘
```

The configurations are structured inside the `backend/monitoring` directory:
- `docker-compose.monitoring.yml`: Orchestration file for Prometheus and Grafana.
- `prometheus/prometheus.yml`: Scraper configuration directing Prometheus to the backend API.
- `grafana/provisioning/datasources/datasources.yml`: Auto-registers Prometheus as the default data source.
- `grafana/provisioning/dashboards/dashboards.yml`: Configures the automatic JSON dashboard loader.
- `grafana/dashboards/*.json`: Complete dashboard configurations.

---

## 2. Quick Start Deployment

To deploy the monitoring stack locally or in your staging environment, run the following Docker Compose command from the `backend/` directory:

```bash
# Start the monitoring stack in detached mode
docker compose -f monitoring/docker-compose.monitoring.yml up -d
```

### Accessing the Interfaces
- **Grafana**: Open [http://localhost:3000](http://localhost:3000)
- **Prometheus**: Open [http://localhost:9090](http://localhost:9090)

### Default Credentials
- **Username**: `admin`
- **Password**: `admin` *(You will be prompted to change this on your first login unless overridden by environment variables)*

---

## 3. Production Security & Environment Tuning

For production environments, ensure you harden the Grafana deployment using environment variables or a `.env` file.

### Environment Overrides (`backend/.env`)
Add the following parameters to secure access:
```env
GRAFANA_ADMIN_USER="sitam_sre_admin"
GRAFANA_ADMIN_PASSWORD="ChooseASecureAndComplexPasswordHere"
```
These values are read by `docker-compose.monitoring.yml` upon initialization.

### Network Isolation Recommendations
- **Internal Only**: Keep port `3000` (Grafana) and `9090` (Prometheus) blocked at your cloud firewall level (e.g. AWS Security Groups, GCP Firewall Rules). Access them only through a private VPN, a reverse proxy (e.g., Traefik or Nginx with OAuth2 protection), or secure SSH tunnel.
- **Scraper Authentication**: If scraping the metrics endpoint across public clouds, ensure you enable the bearer token toggle `METRICS_BEARER_TOKEN` in your application environment, and add the credentials to `prometheus.yml`.

---

## 4. Provisioned Dashboards Directory

The SITAM Smart ERP monitoring ecosystem comes with **8 pre-provisioned dashboards** optimized for dark-theme viewing, high SRE usability, and responsive mobile/tablet layout.

### 1. Infrastructure Overview (`infrastructure-overview.json`)
*Provides a high-level operational health scorecard of hardware resources and services connectivity.*
- **Key Visuals**: Uptime Stat, Redis Status, Event Loop Lag (ms), Active WS Connections, CPU Core Usage, Memory RSS vs. Heap.
- **Operational Action**: If **Event Loop Lag** spikes above 100ms or **Redis Status** drops to 0, immediate escalation is required.

### 2. API Performance (`api-performance.json`)
*Monitors request throughput and response latencies using golden signal metrics.*
- **Key Visuals**: Throughput (requests/sec), Latency Heatmap, Latency Percentiles (p50, p95, p99), HTTP Status Code Distribution, Slow Requests Spikes (>500ms).
- **Operational Action**: Watch for an increase in **5xx status codes** or **p99 latency** climbing above 1.5 seconds, which indicates database or Puppeteer pool saturation.

### 3. Redis & BullMQ Queues (`redis-queues.json`)
*Tracks queue depth and worker throughput, critical for the decoupled Puppeteer scraper architecture.*
- **Key Visuals**: Waiting Jobs, Active Jobs, Completed/Failed Jobs, Queue Latency (seconds spent in queue before worker pick-up), Redis Reconnects.
- **Operational Action**: A rising curve in **Waiting Jobs** paired with zero **Active Jobs** suggests worker processes are offline or blocked.

### 4. Puppeteer Browser Pool (`browser-pool.json`)
*Deep-dive telemetry into Chromium lifecycle, crucial for identifying memory leaks and zombie processes.*
- **Key Visuals**: Active Browser Count, Active Incognito Contexts, Browser Crashes (Total), Recycle Count, Sync Duration.
- **Operational Action**: A spike in **Browser Crashes** indicates system resource exhaustion (RAM depletion). If **Sync Duration** exceeds 30 seconds, the target university portal may be throttling requests.

### 5. PostgreSQL Performance (`postgres.json`)
*Monitors query latency, connection pool usage, and transaction speeds.*
- **Key Visuals**: Active SQL Connections, Prisma Query Latency Histogram, Slow Query Count (>200ms), DB Throughput.
- **Operational Action**: If **Active SQL Connections** exceed 80% of the maximum pool size, scale up the database or connection pool settings.

### 6. WebSocket & Firebase (`realtime-services.json`)
*Analyzes live notification delivery channels and active client connections.*
- **Key Visuals**: Active WS Client Connections, Message Delivery Throughput, FCM Failures, Notification dispatch latency.
- **Operational Action**: High **FCM Failures** indicate outdated client tokens or credentials issues.

### 7. ERP Health & Circuit Breaker (`erp-health.json`)
*Uptime and reliability index of external target portals and the protective circuit breaker state.*
- **Key Visuals**: Circuit Breaker State (0=CLOSED, 0.5=HALF-OPEN, 1=OPEN), Outage Frequency, Sync Failure Rate.
- **Operational Action**: When **Circuit Breaker State** flips to 1 (OPEN), the system goes into fail-fast mode. Investigate whether the university portal has gone offline or changed its DOM layout.

### 8. Worker Observability (`workers.json`)
*Tracks background daemon activity, job concurrency, and execution durations.*
- **Key Visuals**: Active Workers, Job Throughput (jobs/min), Job Durations, Worker Crashes.
- **Operational Action**: Scale worker instances horizontally if job durations increase under heavy concurrent load.

---

## 5. Troubleshooting & SRE Runbook

### Issue: Panels show "No Data" or "Data Source not found"
1. Verify Prometheus is running and healthy:
   ```bash
   docker ps | grep prometheus
   ```
2. Check the Grafana Data Source page (Settings -> Data Sources). The **Prometheus** data source should be listed as Default and point to `http://prometheus:9090`. Click **Save & Test** to verify connection.
3. Verify that the backend application is running and reachable from the Prometheus container. In `prometheus.yml`, we use `host.docker.internal:3001` or `app:3001`. Ensure the backend port `3001` is exposed.

### Issue: Grafana changes are lost after container restart
Ensure the `grafana_data` volume is correctly mounted and persistent. By default, it maps to `/var/lib/grafana` inside the container. Check that you are not running with `--rm` flag or modifying dashboards in a way that bypasses persistent volumes.

### Issue: Scrape target shows "DOWN" in Prometheus UI
1. Open [http://localhost:9090/targets](http://localhost:9090/targets) inside your browser.
2. Inspect the error message. If it says `connection refused`, verify your backend application is actively listening on port `3001` (run `netstat -ano | findstr 3001` on Windows or `sudo lsof -i :3001` on Linux).
3. If running inside a containerized setup, verify that both containers share the same network, or `host.docker.internal` points to the host machine interface.
