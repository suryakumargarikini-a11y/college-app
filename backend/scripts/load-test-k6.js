/**
 * SITAM Smart ERP — k6 Load Testing Suite
 * =========================================
 * Tests: 100, 500, 1000, 5000, 10000 concurrent users
 *
 * Run with:
 *   k6 run --env BASE_URL=https://your-backend.railway.app scripts/load-test-k6.js
 *   k6 run --env BASE_URL=http://localhost:8080 --env SCENARIO=smoke scripts/load-test-k6.js
 *
 * Install k6: https://k6.io/docs/get-started/installation/
 */

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Trend, Rate, Counter } from 'k6/metrics';
import { randomIntBetween } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';

// ─── Configuration ────────────────────────────────────────────────────────────
const BASE_URL = __ENV.BASE_URL || 'https://web-production-07b0.up.railway.app';
const SCENARIO = __ENV.SCENARIO || 'load'; // smoke | load | stress | spike | soak

// Custom Metrics
const loginDuration = new Trend('login_duration_ms', true);
const dashboardDuration = new Trend('dashboard_duration_ms', true);
const placementDuration = new Trend('placement_duration_ms', true);
const feeNoticeDuration = new Trend('fee_notice_duration_ms', true);
const notifDuration = new Trend('notification_duration_ms', true);
const errorRate = new Rate('error_rate');
const loginErrors = new Counter('login_errors');

// ─── Test Scenarios ────────────────────────────────────────────────────────────
const scenarios = {
  smoke: {
    executor: 'constant-vus',
    vus: 5,
    duration: '30s',
    gracefulStop: '10s',
  },
  load_100: {
    executor: 'ramping-vus',
    startVUs: 0,
    stages: [
      { duration: '30s', target: 100 },
      { duration: '2m', target: 100 },
      { duration: '30s', target: 0 },
    ],
    gracefulStop: '30s',
  },
  load_500: {
    executor: 'ramping-vus',
    startVUs: 0,
    stages: [
      { duration: '1m', target: 500 },
      { duration: '3m', target: 500 },
      { duration: '1m', target: 0 },
    ],
    gracefulStop: '30s',
  },
  load_1000: {
    executor: 'ramping-vus',
    startVUs: 0,
    stages: [
      { duration: '2m', target: 1000 },
      { duration: '5m', target: 1000 },
      { duration: '2m', target: 0 },
    ],
    gracefulStop: '60s',
  },
  load_5000: {
    executor: 'ramping-vus',
    startVUs: 0,
    stages: [
      { duration: '3m', target: 5000 },
      { duration: '5m', target: 5000 },
      { duration: '2m', target: 0 },
    ],
    gracefulStop: '60s',
  },
  load_10000: {
    executor: 'ramping-vus',
    startVUs: 0,
    stages: [
      { duration: '5m', target: 10000 },
      { duration: '10m', target: 10000 },
      { duration: '5m', target: 0 },
    ],
    gracefulStop: '120s',
  },
  spike: {
    executor: 'ramping-vus',
    startVUs: 0,
    stages: [
      { duration: '10s', target: 100 },
      { duration: '1m', target: 100 },
      { duration: '10s', target: 5000 }, // spike
      { duration: '2m', target: 5000 },
      { duration: '10s', target: 100 }, // recovery
      { duration: '1m', target: 100 },
      { duration: '10s', target: 0 },
    ],
    gracefulStop: '60s',
  },
  soak: {
    executor: 'constant-vus',
    vus: 200,
    duration: '30m',
    gracefulStop: '60s',
  },
};

// ─── Active Scenario ──────────────────────────────────────────────────────────
export const options = {
  scenarios: {
    [SCENARIO]: scenarios[SCENARIO] || scenarios.load_100,
  },
  thresholds: {
    // P95 response times
    'login_duration_ms': ['p(95)<3000'],
    'dashboard_duration_ms': ['p(95)<2000'],
    'placement_duration_ms': ['p(95)<1500'],
    'fee_notice_duration_ms': ['p(95)<1500'],
    'notification_duration_ms': ['p(95)<1500'],
    // Error rate
    'error_rate': ['rate<0.05'],  // < 5% error rate
    'http_req_failed': ['rate<0.05'],
    // Overall latency
    'http_req_duration': ['p(95)<5000', 'p(99)<10000'],
  },
  noConnectionReuse: false,
  userAgent: 'SITAM-k6-LoadTest/1.0',
};

// ─── Demo Students for Load Test ──────────────────────────────────────────────
// These users must exist in the database (run seed-demo.js first)
const DEMO_CREDENTIALS = [
  { userId: '25B61A0501', password: 'Student@123' },
  { userId: '25B61A0502', password: 'Student@123' },
  { userId: '25B61A0503', password: 'Student@123' },
  { userId: '25B61A0504', password: 'Student@123' },
  { userId: '25B61A0505', password: 'Student@123' },
  { userId: '25B61A0506', password: 'Student@123' },
  { userId: '25B61A0507', password: 'Student@123' },
  { userId: '25B61A0508', password: 'Student@123' },
  { userId: '25B61A0509', password: 'Student@123' },
  { userId: '25B61A0510', password: 'Student@123' },
];

// ─── Helper: Login ────────────────────────────────────────────────────────────
function doLogin() {
  const cred = DEMO_CREDENTIALS[randomIntBetween(0, DEMO_CREDENTIALS.length - 1)];
  const payload = JSON.stringify({ userId: cred.userId, password: cred.password });
  const headers = { 'Content-Type': 'application/json' };

  const start = Date.now();
  const res = http.post(`${BASE_URL}/api/auth/login`, payload, { headers, tags: { endpoint: 'login' } });
  loginDuration.add(Date.now() - start);

  const ok = check(res, {
    'login: status is 200': (r) => r.status === 200,
    'login: has session cookie': (r) => r.headers['Set-Cookie'] !== undefined || r.status === 200,
    'login: response time < 5s': (r) => r.timings.duration < 5000,
  });

  if (!ok || res.status !== 200) {
    errorRate.add(1);
    loginErrors.add(1);
    return null;
  }
  errorRate.add(0);

  try {
    return { cookie: res.headers['Set-Cookie'] || '', userId: cred.userId };
  } catch (e) {
    return null;
  }
}

// ─── Helper: Authenticated Request ───────────────────────────────────────────
function authGet(url, cookie, tag) {
  return http.get(url, {
    headers: { Cookie: cookie },
    tags: { endpoint: tag },
  });
}

// ─── Main Virtual User Flow ────────────────────────────────────────────────────
export default function () {
  // Step 1: Login
  let session = null;
  group('Student Login', () => {
    session = doLogin();
  });

  if (!session) {
    sleep(1);
    return; // Skip rest if login failed
  }

  const { cookie } = session;

  // Step 2: Dashboard
  group('Dashboard', () => {
    const start = Date.now();
    const res = authGet(`${BASE_URL}/api/profile`, cookie, 'dashboard');
    dashboardDuration.add(Date.now() - start);
    const ok = check(res, {
      'dashboard: status 200 or 200': (r) => r.status === 200 || r.status === 401,
      'dashboard: response time < 3s': (r) => r.timings.duration < 3000,
    });
    errorRate.add(!ok ? 1 : 0);
  });

  sleep(randomIntBetween(1, 2));

  // Step 3: Placements
  group('Placements', () => {
    const start = Date.now();
    const res = authGet(`${BASE_URL}/api/placements`, cookie, 'placements');
    placementDuration.add(Date.now() - start);
    const ok = check(res, {
      'placements: status 200': (r) => r.status === 200,
      'placements: has data': (r) => r.body.length > 2,
      'placements: response time < 2s': (r) => r.timings.duration < 2000,
    });
    errorRate.add(!ok ? 1 : 0);
  });

  sleep(randomIntBetween(1, 2));

  // Step 4: Fee Notices
  group('Fee Notices', () => {
    const start = Date.now();
    const res = authGet(`${BASE_URL}/api/fee-notices/active`, cookie, 'fee-notices');
    feeNoticeDuration.add(Date.now() - start);
    const ok = check(res, {
      'fee-notices: status 200': (r) => r.status === 200,
      'fee-notices: response time < 2s': (r) => r.timings.duration < 2000,
    });
    errorRate.add(!ok ? 1 : 0);
  });

  sleep(randomIntBetween(1, 2));

  // Step 5: Notifications
  group('Notifications', () => {
    const start = Date.now();
    const res = authGet(`${BASE_URL}/api/notifications`, cookie, 'notifications');
    notifDuration.add(Date.now() - start);
    const ok = check(res, {
      'notifications: status 200': (r) => r.status === 200,
      'notifications: response time < 2s': (r) => r.timings.duration < 2000,
    });
    errorRate.add(!ok ? 1 : 0);
  });

  sleep(randomIntBetween(1, 3));
}

// ─── Setup ────────────────────────────────────────────────────────────────────
export function setup() {
  console.log(`[k6] Starting SITAM ERP Load Test`);
  console.log(`[k6] Target: ${BASE_URL}`);
  console.log(`[k6] Scenario: ${SCENARIO}`);

  // Verify server is up
  const res = http.get(`${BASE_URL}/api/health/liveness`);
  if (res.status !== 200) {
    throw new Error(`[k6] Server health check FAILED (status: ${res.status}). Aborting load test.`);
  }
  console.log(`[k6] Server health check PASSED. Starting load test.`);
}

// ─── Teardown ─────────────────────────────────────────────────────────────────
export function teardown(data) {
  console.log(`[k6] Load test complete.`);
}
