# ERP Provider Architecture

## Overview

The SITAM Smart ERP backend uses a **provider-agnostic architecture** for all ERP data
integration. The provider layer completely isolates ERP-specific implementation details
(Puppeteer scraping, ASPX HTML parsing) from the platform core.

## Architecture Layers

```
┌──────────────────────────────────────────────────────────┐
│               PLATFORM CORE                              │
│  Controllers → Services → Repositories → PostgreSQL     │
└──────────────────────────────────────────────────────────┘
               │ uses
               ▼
┌──────────────────────────────────────────────────────────┐
│                PROVIDER LAYER                            │
│  ERPProvider (interface)                                  │
│    ├── SITAMScraperProvider  (Puppeteer + Cheerio)        │
│    ├── SITAMOfficialAPIProvider (REST API — future)       │
│    └── MockERPProvider       (deterministic test data)    │
└──────────────────────────────────────────────────────────┘
               │ returns
               ▼
┌──────────────────────────────────────────────────────────┐
│            NORMALIZED DATA MODELS                         │
│  SyncResult, AttendanceResult, MarksResult,               │
│  FeeResult, AssignmentResult, ProfileRecord...            │
└──────────────────────────────────────────────────────────┘
```

## Provider Selection

The active provider is selected via the `ERP_PROVIDER` environment variable:

| Value | Provider | Status |
|-------|----------|--------|
| `scraper` (default) | SITAMScraperProvider | Production |
| `official-api` | SITAMOfficialAPIProvider | Future |
| `mock` | MockERPProvider | Testing only |

```env
# .env
ERP_PROVIDER=scraper        # Default — use Puppeteer scraper
ERP_PROVIDER=official-api   # Future — use official REST API
ERP_PROVIDER=mock           # Testing — use deterministic mock data
```

## Sync Flow

### Full Sync (New Login)
```
Worker/Route
  └→ syncService.runFullSync(userId, password)
       └→ provider.syncStudent(userId, password)  ← provider-agnostic call
            └→ [SITAMScraperProvider]:
                 └→ PuppeteerService.login()       ← Puppeteer login
                 └→ ERPScraper.parse*()            ← Cheerio parsing
                 └→ Normalizes to SyncResult       ← provider boundary
       └→ syncService.syncStudentData()
            └→ Repositories.save*()               ← PostgreSQL persistence
```

### Incremental Sync (Existing Session)
```
SyncQueue.tick()
  └→ provider.syncIncremental(userId, password, session)
       └→ [SITAMScraperProvider]:
            ├→ validateSession() → session valid?
            │    YES: Axios-based crawl with existing cookies
            │    NO:  Falls back to full login (syncStudent)
            └→ Normalizes to SyncResult
```

## Key Design Decisions

1. **Provider = Login + Fetch**: The provider owns the complete data acquisition cycle
2. **Normalized models at boundary**: Provider never returns raw HTML or Puppeteer objects
3. **Repository unchanged**: All database operations remain in `repositories/` unchanged
4. **Service layer unchanged**: `syncService.syncStudentData()` persistence logic preserved
5. **OTel spans preserved**: All `traceSpan()` wrappers remain in place
6. **Queue contracts unchanged**: BullMQ job schemas are not modified

## Adding a New Provider

1. Create `providers/<name>/MyProvider.js` extending `ERPProvider`
2. Implement all methods from `ERPProvider` interface
3. Register in `ProviderFactory.PROVIDER_MAP`
4. Set `ERP_PROVIDER=<name>` in `.env`
5. Deploy — zero changes needed elsewhere

## Error Handling

All provider errors extend `ProviderError` and carry:
- `isRetryable` — whether the worker should retry
- `retryAfterMs` — how long to wait before retrying
- `providerName` — which provider threw the error
- `operationName` — which method was executing

See `providers/errors/index.js` for all error types.
