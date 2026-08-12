import axios from 'axios';
import { authStore } from '../store/authStore';

const DEV_FALLBACK_API = 'http://localhost:3001/api';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || DEV_FALLBACK_API,
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
