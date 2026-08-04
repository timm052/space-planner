import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    // Honor the port injected by the Claude Preview launcher (autoPort) so the
    // harness proxy lines up with the port Vite actually binds; fall back to 5173.
    port: Number(process.env.PORT) || 5173,
    strictPort: false,
    proxy: {
      // API_PORT lets a second dev instance run against its own API (the
      // server honours the same variable — see server/index.js).
      '/api': `http://localhost:${process.env.API_PORT || 3001}`,
    },
  },
  build: {
    outDir: 'dist',
  },
});
