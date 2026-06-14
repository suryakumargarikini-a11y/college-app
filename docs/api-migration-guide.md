# ERP API Migration Guide

## When to Use This Guide

When SITAM releases an official REST API, follow this guide to migrate from
`SITAMScraperProvider` (Puppeteer-based) to `SITAMOfficialAPIProvider` (REST).

**Zero frontend, queue, or database changes are required.**

---

## Migration Checklist

### 1. Obtain API Credentials

```bash
# Add to .env
SITAM_API_BASE_URL=https://api.sitams.org/v1
SITAM_API_KEY=your_api_key_here
SITAM_API_CLIENT_ID=your_client_id
```

### 2. Implement the API Provider

Open `backend/providers/api/SITAMOfficialAPIProvider.js` and replace each
scaffold `throw new Error(...)` stub with the actual API call:

```javascript
// BEFORE (scaffold):
async getAttendance(studentId, options = {}) {
    throw new Error('[SITAMOfficialAPI] getAttendance() not yet implemented');
}

// AFTER (implemented):
async getAttendance(studentId, options = {}) {
    const token = options.token || this._getToken(studentId);
    const resp  = await this.apiClient.get(`/students/${studentId}/attendance`, {
        headers: { Authorization: `Bearer ${token}` }
    });
    return new AttendanceResult({
        records: resp.data.attendance.map(a => AttendanceRecord.create(a)),
        overallPercentage: resp.data.overall_percentage
    });
}
```

### 3. Activate the New Provider

```bash
# .env — single line change to switch providers
ERP_PROVIDER=official-api
```

### 4. Restart the Server

```bash
pm start
# ✓ ProviderFactory will log: "Active ERP provider: sitam-official-api"
```

### 5. Validate

```bash
node scripts/test-provider-interface.js
# All interface compliance tests should pass

# Hit the health endpoint
curl http://localhost:3000/api/health/readiness
# Should return ERP health from the new provider
```

---

## Rollback Plan

If the API provider has issues, revert instantly:

```bash
# .env
ERP_PROVIDER=scraper   # Back to Puppeteer
```

Restart the server. Zero data loss. Zero downtime.

---

## What Will NOT Change

- ✅ All REST API routes (`/api/attendance`, `/api/marks`, `/api/fees`, etc.)
- ✅ All database schemas and Prisma models
- ✅ All BullMQ job structures
- ✅ All WebSocket events
- ✅ All Firebase push notifications
- ✅ All OTel traces and Grafana dashboards
- ✅ All frontend and Android app code
- ✅ All SRE and alerting systems
- ✅ All normalized model schemas

## What WILL Change

- The `SITAMOfficialAPIProvider.js` implementation stubs (filled in)
- The `ERP_PROVIDER=official-api` env var
- Optionally: Remove Puppeteer/Chrome from Docker image (major size reduction)
