# Changelog

All notable changes to the SITAM Smart ERP platform will be documented in this file.

---

## [1.0.0] — 2026-06-14

### Added
- **Dynamic Config Generation**: Introduced a `scripts/generate-config.js` script to dynamically generate `frontend/config.js` from the `API_BASE_URL` env variable.
- **Cross-platform Database Switching**: Added `scripts/use-pg.js` and `scripts/use-sqlite.js` scripts, mapped to `npm run db:setup-pg` and `npm run db:setup-sqlite` respectively, for seamless local SQLite development and production PostgreSQL deployment.
- **CI/CD GitHub Actions Pipeline**: Created a complete `.github/workflows/ci.yml` pipeline that installs dependencies, lints, generates the Prisma client, verifies backend server bootstrapping, and runs Android Gradle builds.
- **Production CORS configuration**: Supported a comma-separated `ALLOWED_ORIGINS` environment variable in the backend `server.js`.
- **Structured SRE Telemetry Logging**: Added Winston structured logger with support for `LOG_LEVEL` environment variable and auto-redaction of secrets/passwords/cookies in log files.
- **Capacitor Native Integration**:
  - Implemented `@capacitor/browser` for safe in-app payment tab redirects.
  - Implemented `@capacitor/push-notifications` for background push notifications.
  - Created a robust custom back button listener to sequentially handle closing the drawer, closing active modals/overlays, popping navigation history, or exit-on-double-back-press (2s window).
  - Integrated `window.scrollPositions` tracking to preserve and restore scroll coordinates during page transitions.

### Changed
- **Decoupled Dashboard Loading**: Modified the dashboard card rendering logic to perform non-blocking parallel fetches rather than a blocking `Promise.all` call.
- **Dashboard Cleanup**: Filtered out all payment and fee-related notice alerts from the dashboard banner.
- **API Fallback Bindings**: Set default fallback text values (`"--"`, `"--%"`, `"0"`, `"Dues & History"`) on card load failures to prevent infinite skeleton loaders.
- **Session Expiry Recovery**: Added a response scanner that checks for HTML redirections, triggers a silent background re-authentication via `/api/sync` once, and retries the request before throwing a session error.

### Removed
- **Unnecessary UI buttons**: Removed "View Statement" from the Fees template in `app.js` and mock HTML screens.
- **Hardcoded local URLs**: Replaced all hardcoded localhost/10.x.x.x IPs in the scraper provider (`SITAMScraperProvider.js`) with the `process.env.ERP_BASE_URL` environment variable.
