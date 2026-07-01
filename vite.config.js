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
      '/api': 'http://localhost:3001',
    },
  },
  build: {
    outDir: 'dist',
  },
});
