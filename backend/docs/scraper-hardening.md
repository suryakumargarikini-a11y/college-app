# SITAM Smart ERP — Scraper Hardening Call Graph

This document tracks the integrated scraper reliability modules:

1. **ERPMaintenanceDetector**: Monitors the ERP server for maintenance windows and schedules downtime handling.
2. **AntiBotDetector**: Verifies that the scraper is not blocked by cloud firewalls, anti-bot screens, or Captcha blocks.
3. **PartialSyncRecovery**: Saves sync checkpoints to DB and recovers sync progress in case of random job timeouts.
4. **DOMDriftDetector**: Computes structural changes (drift) in target pages to trigger DOM refactorings when ERP code updates.
5. **AdaptiveSelectorOptimizer**: Re-orders selector list chains and optimizes the execution flow.
6. **BrowserReputationManager**: Sanitizes browser instances based on CAPTCHAs, failures, and timeouts.
7. **AdaptiveRetryClassifier**: Decides retry strategies dynamically for failed worker jobs.
8. **QueuePressureManager**: Throttles scraper requests if queue memory capacity drops.
9. **AdaptiveLoadShedding**: Restricts non-essential scraping features when platform load spikes.
10. **ScraperReliabilityForecaster**: Periodically forecasts scraping health and logs metrics.
