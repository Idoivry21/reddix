// @vitest-environment node

import http from 'node:http';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../server/app';
import { createStorage } from '../server/storage';
import { getProviderHealthCommands } from '../src/shared/commandBuilders';

let server: http.Server | null = null;

afterEach(async () => {
  if (server) {
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = null;
  }
});

type AppOptions = Partial<Parameters<typeof createApp>[0]>;

async function start(dataDir: string, options: AppOptions = {}): Promise<string> {
  const { app } = createApp({
    storage: createStorage({ baseDir: dataDir }),
    dataDir,
    providerHealthChecker: async () => false,
    ...options
  });
  return new Promise((resolve, reject) => {
    const localServer = app.listen(0, '127.0.0.1', () => {
      const address = localServer.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Test server failed to listen'));
        return;
      }
      resolve(`http://127.0.0.1:${address.port}`);
    });
    localServer.once('error', (error) => {
      reject(error);
    });
    server = localServer;
  });
}

describe('GET /api/health (finding 5)', () => {
  it('reports ok=true with a writable data dir and surfaces storage + sse state', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'reddix-health-'));
    const base = await start(dataDir);

    const response = await fetch(`${base}/api/health`);
    const body = (await response.json()) as {
      ok: boolean;
      storage: { writable: boolean };
      sseClients: number;
    };

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.storage.writable).toBe(true);
    expect(body.sseClients).toBe(0);
  });

  it('returns 503 and ok=false when the data dir is not writable', async () => {
    // A regular file stands where the data dir should be -> mkdir/access fail.
    const root = await mkdtemp(path.join(tmpdir(), 'reddix-health-'));
    const filePath = path.join(root, 'not-a-dir');
    await writeFile(filePath, 'x');
    const dataDir = path.join(filePath, 'data');
    const base = await start(dataDir);

    const response = await fetch(`${base}/api/health`);
    const body = (await response.json()) as { ok: boolean; storage: { writable: boolean } };

    expect(response.status).toBe(503);
    expect(body.ok).toBe(false);
    expect(body.storage.writable).toBe(false);
  });

  it('dedupes concurrent provider probes and reuses the cached health snapshot', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'reddix-health-'));
    const providerHealthChecker = vi.fn(async () => true);
    const base = await start(dataDir, { providerHealthChecker, healthCacheTtlMs: 30_000 });

    await Promise.all([
      fetch(`${base}/api/health`),
      fetch(`${base}/api/health`),
      fetch(`${base}/api/health`)
    ]);
    await fetch(`${base}/api/health`);

    expect(providerHealthChecker).toHaveBeenCalledTimes(getProviderHealthCommands().length);
  });
});

describe('GET /api/metrics (finding 10)', () => {
  it('exposes a counters/histograms snapshot', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'reddix-metrics-'));
    const base = await start(dataDir);

    const response = await fetch(`${base}/api/metrics`);
    const body = (await response.json()) as { counters: unknown; histograms: unknown };

    expect(response.status).toBe(200);
    expect(body).toHaveProperty('counters');
    expect(body).toHaveProperty('histograms');
  });
});
