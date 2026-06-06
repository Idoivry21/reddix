import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:8787',
      '/events': 'http://127.0.0.1:8787'
    }
  },
  build: {
    sourcemap: true,
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        manualChunks: {
          // Split the icon library out of the main bundle so it can be cached
          // independently of app code. The canvas is now bespoke (no @xyflow).
          icons: ['lucide-react']
        }
      }
    }
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    globals: true,
    css: true,
    exclude: ['**/node_modules/**', '**/dist/**', 'tests/e2e/**']
  }
});
