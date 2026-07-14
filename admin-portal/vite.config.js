import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // NOTE: No proxy — all API calls go directly to Render in production.
    // For local dev, set VITE_API_BASE_URL=http://localhost:3001/api
    // in admin-portal/.env.local (not committed to git).
  },
  build: {
    outDir: 'dist'
  }
});
