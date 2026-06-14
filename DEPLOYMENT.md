# SITAM Smart ERP — Deployment Guide

This document provides step-by-step instructions to deploy the SITAM Smart ERP backend and frontend services to cloud providers (Railway, Render, Vercel, Firebase) and generate native Android APKs.

---

## 📋 Production Environment Check

Verify all variables are configured in your target hosting platform's Dashboard settings:

| Variable | Description | Recommended Setting |
| :--- | :--- | :--- |
| `NODE_ENV` | Running environment mode | `production` |
| `PORT` | Web service listening port | `3000` (Assigned dynamically) |
| `DATABASE_URL` | PostgreSQL Database Connection string | `postgresql://...` |
| `REDIS_URL` | Redis URL for session storage & cache | `redis://...` |
| `API_BASE_URL` | Client endpoint target for requests | `https://sitam-api.up.railway.app/api` |
| `ERP_BASE_URL` | Target ERP base scraper target | `https://sitamecap.co.in/SATYA` |
| `JWT_SECRET` | Token encryption secret key | Custom strong alphanumeric string |
| `LOG_LEVEL` | Logging verbosity filter | `info` or `warn` |
| `APP_VERSION` | Application release version | `1.0.0` |
| `ALLOWED_ORIGINS` | Comma-separated list of CORS origins | `https://sitam-app.vercel.app,capacitor://localhost` |

---

## 🚀 Backend Cloud Deployments

The backend contains a `Dockerfile` at the root/backend directory, which is auto-detected by Render and Railway for container deployments.

### 🚂 Railway Deployment (Recommended)
1. Log in to **Railway.app** and click **New Project**.
2. Select **Deploy from GitHub Repo** and select the repository.
3. Click **Add Plugin** and select **PostgreSQL** and **Redis**.
4. In the Service settings of your backend, reference the database and redis variables:
   - `DATABASE_URL` = `${{Postgres.DATABASE_URL}}`
   - `REDIS_URL` = `${{Redis.REDIS_URL}}`
5. Add all other environment variables listed in the checklist.
6. Configure the **Build Command**:
   ```bash
   npm run db:setup-pg && cd backend && npx prisma migrate deploy && npx prisma generate
   ```
7. Set the **Start Command**:
   ```bash
   cd backend && node server.js
   ```

### ☁️ Render Deployment
1. Log in to **Render.com** and click **New** -> **Web Service**.
2. Connect your GitHub repository.
3. Add a **PostgreSQL** database and a **Redis** instance from Render.
4. Set the following Web Service properties:
   - **Environment**: `Node` or `Docker`
   - **Build Command**: `npm run db:setup-pg && cd backend && npx prisma generate && npx prisma migrate deploy`
   - **Start Command**: `cd backend && node server.js`
5. Inject all environment variables into the **Advanced Settings** screen.

---

## 🌐 Frontend Static Deployments

### ⚡ Vercel Deployment
1. Log in to **Vercel.com** and connect your GitHub repo.
2. Configure a new project with root directory pointing to `frontend/`.
3. Set the **Build Command**:
   - We need to generate `config.js` before deploying:
   ```bash
   node ../scripts/generate-config.js
   ```
   *(Note: This uses the root script to output `config.js` into the `frontend` folder).*
4. Add the `API_BASE_URL` env variable in the Vercel project settings.
5. Vercel will build and serve the plain static files and route SPA paths cleanly.

### 🔥 Firebase Hosting
1. Install Firebase CLI: `npm install -g firebase-tools`
2. Run `firebase login` and `firebase init hosting`.
3. Map the public directory to `frontend/`.
4. Generate the config:
   ```bash
   API_BASE_URL="https://your-backend-url.com/api" node scripts/generate-config.js
   ```
5. Deploy using: `firebase deploy --only hosting`

---

## 📲 Native Android APK Generation

To generate the stable, production-signed Android APK:

1. **Install Android dependencies**:
   Ensure `gradle` and standard command line build tools are set up.
2. **Generate production config**:
   Export your production backend API URL:
   ```powershell
   $env:API_BASE_URL = "https://your-backend-api.com/api"
   node scripts/generate-config.js
   ```
3. **Sync web assets**:
   ```bash
   npx cap sync android
   ```
4. **Compile Production Release Build**:
   ```bash
   cd android
   ./gradlew.bat assembleRelease
   ```
5. The signed, compiled APK is generated at:
   `android/app/build/outputs/apk/release/app-release-unsigned.apk`
