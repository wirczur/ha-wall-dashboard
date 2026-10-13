import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Relative base: the admin UI is served under the HA ingress path (/api/hassio_ingress/<token>/),
// the kiosk under the root of port 8100 — relative URLs work for both.
export default defineConfig({
  root: 'web',
  base: './',
  plugins: [react()],
  build: {
    outDir: '../dist/web',
    emptyOutDir: true,
    chunkSizeWarningLimit: 4000
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8099',
      '/media': 'http://localhost:8099',
      '/ws': { target: 'ws://localhost:8099', ws: true }
    }
  }
});
