import react from '@vitejs/plugin-react';
import { defaultClientConditions, defineConfig } from 'vite';

// In development, Vite serves the client and proxies /ws to the session server.
export default defineConfig({
  plugins: [react()],
  // Bundle the workspace packages from source (see their "veneer-source" exports).
  resolve: { conditions: ['veneer-source', ...defaultClientConditions] },
  server: {
    proxy: {
      '/ws': { target: 'http://127.0.0.1:8080', ws: true },
    },
  },
  build: { sourcemap: true },
});
