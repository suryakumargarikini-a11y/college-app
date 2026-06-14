# Scraper Hardening Architecture

## Overview

The SITAM ERP scraping infrastructure has been hardened from a basic Puppeteer scraper into a **production-grade, self-healing, predictive ERP synchronization platform**.

All changes are **purely additive** — zero existing files were rewritten.

---

## Component Map

```
backend/providers/scraper/
├── selectors/
│   ├── ERPSelectors.js              # Fallback selector chains for every ERP element
│   ├── SelectorResolver.js          # Traverses chains, emits telemetry, throws SelectorDriftError
│   └── AdaptiveSelectorOptimizer.js # Self-healing: promotes/demotes selectors based on success rates
│
├── drift/
│   └── DOMDriftDetector.js          # HTML fingerprinting + drift scoring (0-100)
│
├── antibot/
│   └── AntiBotDetector.js           # CAPTCHA/Cloudflare/maintenance/rate-limit classifier
│
├── retry/
│   └── AdaptiveRetryClassifier.js   # Error → retry strategy mapping
│
├── recovery/
│   └── PartialSyncRecovery.js       # Checkpoint-based resumable sync
│
├── dedup/
│   └── SyncDeduplicator.js          # Distributed Redis NX lock + memory fallback
│
├── health/
│   └── ERPHealthScorer.js           # Rolling 10-min window composite health score
│
├── stealth/
│   └── BrowserStealth.js            # Anti-detection: navigator masking, human typing
│
├── throttle/
│   ├── QueuePressureManager.js      # Adaptive concurrency + queue fairness/starvation
│   └── AdaptiveLoadShedding.js      # 4-mode degradation: NORMAL→DEGRADED→PROTECTED→EMERGENCY
│
├── forensics/
│   └── ForensicsCollector.js        # DOM snapshots + screenshots + nav replay chains
│
├── maintenance/
│   └── ERPMaintenanceDetector.js    # Detects & globally suppresses syncs during downtime
│
├── browser/
│   └── BrowserReputationManager.js  # Per-browser trust scoring + quarantine
│
├── priorities/
│   └── SyncPriorityEngine.js        # Dynamic module ordering + exam/result escalation
│
└── forecasting/
    └── ScraperReliabilityForecaster.js # 60-min rolling telemetry → linear regression forecasts
```

---

## Integration Points

| Component | Triggered By | Affects |
|-----------|-------------|---------|
| `AntiBotDetector` | After every `page.goto()` | Throws, prevents wasted retries |
| `DOMDriftDetector` | After content loads | Alerts ops if ERP redesigned |
| `AdaptiveSelectorOptimizer` | After each selector resolution | Re-orders fallback chains |
| `PartialSyncRecovery` | Before and after each module | Skips already-successful modules |
| `ERPHealthScorer` | Every sync completion | Drives load shedding mode |
| `BrowserReputationManager` | Every CAPTCHA/crash/success | Quarantines bad browsers |
| `ERPMaintenanceDetector` | After login/navigation failure | Global sync suppression |
| `AdaptiveLoadShedding` | Health score updates | Controls browser pool size |
| `SyncPriorityEngine` | Job queue admission | Module order + BullMQ priority |
| `ScraperReliabilityForecaster` | Every 5 minutes | Predictive degradation alerts |

---

## Data Flow

```
Queue Job Received
  → SyncDeduplicator.acquireLock()      ← dedup gate
  → AdaptiveLoadShedding.admitSync()    ← load gate
  → ERPMaintenanceDetector.check()      ← outage gate
  → SyncPriorityEngine.getModuleOrder() ← determine what to sync
  → PartialSyncRecovery.getRecoveryPlan() ← skip completed modules

For each module:
  → BrowserStealth.applyStealthProfile() ← anti-detection
  → page.goto(url)
  → AntiBotDetector.assertNoBotChallenge() ← challenge check
  → SelectorResolver.resolve() ← fallback chain traversal
  → AdaptiveSelectorOptimizer.recordOutcome() ← learning
  → DOMDriftDetector.analyze() ← structural validation
  → PartialSyncRecovery.saveCheckpoint() ← progress record

On failure:
  → ForensicsCollector.captureFailure() ← snapshot
  → AdaptiveRetryClassifier.classify() ← retry decision
  → BrowserReputationManager.recordEvent() ← trust update
  → ERPHealthScorer.recordCompletion() ← health update

On full success:
  → SyncDeduplicator.releaseLock()
  → PartialSyncRecovery.clearCheckpoint()
  → ScraperReliabilityForecaster.recordSyncAttempt()
```

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `ERP_BASE_URL` | required | Base URL of ERP (e.g., `https://erp.college.edu`) |
| `SYNC_LOCK_TTL_MS` | `120000` | Sync deduplication lock TTL (ms) |
| `SESSION_ENCRYPTION_KEY` | optional | AES-256-GCM key for session encryption |
| `BROWSER_POOL_SIZE` | `3` | Initial browser pool size |
| `BROWSER_ACQUIRE_TIMEOUT_MS` | `30000` | Browser pool acquire timeout |
