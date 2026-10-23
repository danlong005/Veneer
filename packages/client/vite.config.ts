import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// In development, Vite serves the client and proxies /ws to the session server.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/ws': { target: 'http://127.0.0.1:8080', ws: true },
    },
  },
  build: { sourcemap: true },
});
