# SITAM Smart ERP — Student ERP Mobile Platform

SITAM Smart ERP is a production-ready, enterprise-grade, cloud-deployable student ERP platform. It connects a premium glassmorphic mobile client (via Capacitor/Android) with a resilient backend featuring built-in scrapers, session persistence, automatic re-authentication, SRE controls, and advanced security telemetry.

---

## 📁 Repository Layout

```text
├── android/               # Native Android Capacitor app shell & build configs
├── backend/               # Node.js/Express production-ready backend API
│   ├── controllers/      # Route request controllers
│   ├── models/           # Normalized normalized models
│   ├── prisma/           # Prisma ORM schemas (SQLite & PostgreSQL)
│   ├── providers/        # Scraper, official API, and mock provider interfaces
│   ├── services/         # Core logic services (Logger, DB, Redis, FCM)
│   └── server.js         # API Server entry point
├── docs/                  # Architectural guides, runbooks & SRE documentation
├── frontend/              # Plain HTML/CSS/JS glassmorphic SPA assets
│   ├── config.js         # Auto-generated build-time configuration (git-ignored)
│   ├── app.js            # Main frontend application router and client logic
│   └── index.html        # HTML entry shell
├── scripts/               # Platform utility scripts (CI, DB configurations)
├── package.json           # Root workflow scripts and Capacitor dependencies
└── start.js               # Multi-service local development server launcher
```

---

## 🚀 Local Development Quickstart

### Prerequisites
- Node.js (v18+)
- SQLite (for local database)
- Android SDK (for compiling APKs)

### Setup & Run
1. **Clone the repository**:
   ```bash
   git clone https://github.com/suryakumargarikini-a11y/college-app.git
   cd college-app
   ```
2. **Install all dependencies**:
   ```bash
   npm install
   cd backend && npm install
   cd ../frontend && npm install
   cd ..
   ```
3. **Configure Environment**:
   Copy the example environment files:
   ```bash
   cp backend/.env.example backend/.env
   cp .env.example .env
   ```
4. **Generate Prisma Client & Seed Database**:
   ```bash
   npm run db:setup-sqlite
   cd backend
   npx prisma migrate dev --name init
   cd ..
   ```
5. **Start Services**:
   Starts the backend on port `3001` and frontend static file server on port `3000`:
   ```bash
   npm start
   ```
6. **Compile Android Build**:
   ```bash
   npx cap sync android
   cd android
   ./gradlew.bat assembleDebug
   ```

---

## ⚡ SRE & Telemetry Controls

The backend features an integrated observability stack (detailed in the [docs/](file:///d:/111/docs) folder):
- **Tracing**: OpenTelemetry auto-instrumentation logging traces directly to OTLP endpoints.
- **Circuit Breaker**: Auto-tripping logic when the ERP portal responds with repeated 5xx errors.
- **Tenancy Quotas**: Active tenant request registry and rate limiting.
- **Metrics**: Prometheus metrics collection available on `/api/metrics` with SLO snapshots.

---

## 🔒 Security Compliance
- **AES-GCM Keystore Storage**: Passwords and tokens are stored in the client using Capacitor SecureKeystore.
- **Secret Redaction Loggers**: Automated scanning and removal of sensitive keys (tokens, passwords, cookies) from logs.
- **FCM Sandbox Mode**: Dynamic fallback to websocket/console mock logging if Firebase credentials are absent.
