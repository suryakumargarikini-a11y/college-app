import axios from 'axios';
import { authStore } from '../store/authStore';

const PROD_API_BASE_URL = 'https://web-production-259f33.up.railway.app/api';
const DEV_FALLBACK_API = 'http://localhost:3001/api';

const resolveBaseURL = () => {
  if (import.meta.env.VITE_API_BASE_URL) return import.meta.env.VITE_API_BASE_URL;
  // If running in browser on production domain (e.g. vercel.app or sitamecap.co.in), use live Railway API
  if (typeof window !== 'undefined' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
    return PROD_API_BASE_URL;
  }
  return DEV_FALLBACK_API;
};

const api = axios.create({
  baseURL: resolveBaseURL(),
  headers: { 'Content-Type': 'application/json' },
  timeout: 30000,
});


// Attach tab-isolated JWT token
api.interceptors.request.use((config) => {
  const token = authStore.getToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Handle 401 — clear current tab session and redirect to login
api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      authStore.clearAuth();
      window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);

export default api;
