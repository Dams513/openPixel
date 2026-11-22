import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const port = Number(process.env.OPENPIXEL_PORT) || 5577;

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/ws': { target: `ws://127.0.0.1:${port}`, ws: true },
      '/api': { target: `http://127.0.0.1:${port}` },
    },
  },
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 1000 },
});
