import axios from 'axios';

const DEV_FALLBACK_API = 'http://localhost:3001/api';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || DEV_FALLBACK_API,
  headers: { 'Content-Type': 'application/json' },
  timeout: 30000,
});

// Attach JWT token from localStorage
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('admin_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Handle 401 — redirect to login
api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('admin_token');
      localStorage.removeItem('admin_user');
      window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);

export default api;
