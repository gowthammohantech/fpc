import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
/// <reference types="vitest" />
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  // Point the dev proxy at a deployed API with VITE_API_PROXY_TARGET; it falls
  // back to the server running locally.
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const apiTarget = env.VITE_API_PROXY_TARGET ?? 'http://localhost:4000';

  return {
    plugins: [react()],
    resolve: {
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
    server: {
      port: 5173,
      // The client calls /api, which is proxied so the browser sees one origin
      // in development and no CORS or cookie complications arise.
      proxy: {
        '/api': { target: apiTarget, changeOrigin: true },
      },
    },
    build: { outDir: 'dist', sourcemap: true },
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./src/test/setup.ts'],
      include: ['src/**/*.test.{ts,tsx}'],
    },
  };
});
