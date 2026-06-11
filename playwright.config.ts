import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('.', import.meta.url));
const nodeBin = path.dirname(process.execPath);
const localBin = path.join(repoRoot, 'node_modules', '.bin');
const e2ePath = [localBin, nodeBin].join(path.delimiter);
const node = JSON.stringify(process.execPath);
const tsxCli = JSON.stringify(fileURLToPath(new URL('./node_modules/tsx/dist/cli.mjs', import.meta.url)));
const viteCli = JSON.stringify(fileURLToPath(new URL('./node_modules/vite/bin/vite.js', import.meta.url)));
const backendPort = 18787;
const frontendPort = 15173;
const backendOrigin = `http://127.0.0.1:${backendPort}`;
const frontendOrigin = `http://127.0.0.1:${frontendPort}`;
const backendEnv = {
  PATH: e2ePath,
  PORT: String(backendPort),
  REDDIX_ALLOWED_ORIGINS: frontendOrigin
};
const frontendEnv = {
  PATH: e2ePath,
  REDDIX_BACKEND_ORIGIN: backendOrigin
};

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  expect: {
    timeout: 5_000
  },
  use: {
    baseURL: frontendOrigin,
    trace: 'on-first-retry'
  },
  webServer: [
    {
      command: `${node} ${tsxCli} watch server/index.ts`,
      url: `${backendOrigin}/api/health`,
      env: backendEnv,
      reuseExistingServer: false,
      timeout: 30_000
    },
    {
      command: `${node} ${viteCli} --host 127.0.0.1 --port ${frontendPort} --strictPort`,
      url: frontendOrigin,
      env: frontendEnv,
      reuseExistingServer: false,
      timeout: 30_000
    }
  ],
  projects: [
    {
      name: 'chromium-desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } }
    },
    {
      name: 'chromium-mobile-readonly',
      use: { ...devices['Pixel 5'], viewport: { width: 390, height: 844 } }
    }
  ]
});
