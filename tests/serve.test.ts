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

async function start(staticDir: string): Promise<string> {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'reddix-serve-data-'));
  const { app } = createApp({ storage: createStorage({ baseDir: dataDir }), dataDir, staticDir });
  return new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      const address = server!.address() as AddressInfo;
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

describe('single-process production serve', () => {
  it('serves the built index.html and the /api/health endpoint', async () => {
    const staticDir = await mkdtemp(path.join(tmpdir(), 'reddix-serve-static-'));
    await writeFile(path.join(staticDir, 'index.html'), '<!doctype html><title>Reddix</title>');

    const base = await start(staticDir);

    const indexResponse = await fetch(`${base}/`);
    expect(indexResponse.status).toBe(200);
    expect(await indexResponse.text()).toContain('Reddix');

    const healthResponse = await fetch(`${base}/api/health`);
    expect(healthResponse.status).toBe(200);
    const health = (await healthResponse.json()) as { ok: boolean; providers: unknown[] };
    expect(health.ok).toBe(true);
    expect(Array.isArray(health.providers)).toBe(true);
  });

  it('falls back to index.html for client-side routes', async () => {
    const staticDir = await mkdtemp(path.join(tmpdir(), 'reddix-serve-static-'));
    await writeFile(path.join(staticDir, 'index.html'), '<!doctype html><title>Reddix SPA</title>');

    const base = await start(staticDir);
    const response = await fetch(`${base}/some/client/route`);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('Reddix SPA');
  });
});
