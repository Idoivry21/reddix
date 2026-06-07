import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

const backendOrigin = process.env.REDDIX_BACKEND_ORIGIN ?? 'http://127.0.0.1:8787';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': backendOrigin,
      '/events': backendOrigin
    }
  },
  build: {
    sourcemap: true,
    chunkSizeWarningLimit: 800,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              // Split the icon library out of the main bundle so it can be
              // cached independently of app code.
              name: 'icons',
              test: 'node_modules/lucide-react'
            }
          ]
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
