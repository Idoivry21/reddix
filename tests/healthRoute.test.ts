// @vitest-environment node

import http from 'node:http';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../server/app';
import { createStorage } from '../server/storage';

let server: http.Server | null = null;

afterEach(async () => {
  if (server) {
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = null;
  }
});

async function start(dataDir: string): Promise<string> {
  const { app } = createApp({ storage: createStorage({ baseDir: dataDir }), dataDir });
  return new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      const address = server!.address() as AddressInfo;
      resolve(`http://127.0.0.1:${address.port}`);
    });
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
