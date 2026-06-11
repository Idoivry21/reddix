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

function mockAppLogger(): NonNullable<AppOptions['logger']> {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    requestLogger: () => (_request: unknown, _response: unknown, next: () => void) => next()
  } as unknown as NonNullable<AppOptions['logger']>;
}

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

/**
 * Open a real SSE connection and resolve once the server has registered the
 * client (signalled by the first `event: ready` chunk, written right after the
 * client is added to the hub), so the health endpoint can observe the live count.
 */
function openSse(url: string): Promise<{ close: () => void }> {
  return new Promise((resolve, reject) => {
    const request = http.get(url, (res) => {
      res.on('data', () => {
        resolve({
          close: () => {
            request.destroy();
            res.destroy();
          }
        });
      });
      res.on('error', () => {});
    });
    request.on('error', reject);
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

  it('logs the storage errno on degraded health without leaking it in the response body', async () => {
    // A regular file stands where the data dir should be -> mkdir/access fail.
    const root = await mkdtemp(path.join(tmpdir(), 'reddix-health-'));
    const filePath = path.join(root, 'not-a-dir');
    await writeFile(filePath, 'x');
    const dataDir = path.join(filePath, 'data');
    const logger = mockAppLogger();
    const errorMock = logger.error as ReturnType<typeof vi.fn>;
    const base = await start(dataDir, { logger });

    const response = await fetch(`${base}/api/health`);
    const body = (await response.json()) as { ok: boolean; storage: { writable: boolean; errno?: string } };

    expect(response.status).toBe(503);
    expect(logger.error).toHaveBeenCalledWith(
      'health.degraded',
      expect.objectContaining({ storageWritable: false, errno: expect.any(String) })
    );
    const degradedCall = errorMock.mock.calls.find(([message]) => message === 'health.degraded');
    expect(degradedCall).toBeDefined();
    const errno = (degradedCall![1] as { errno: string }).errno;
    expect(body.storage).toEqual({ writable: false });
    expect(JSON.stringify(body)).not.toContain(errno);
  });

  it('reports the live SSE client count, not a value frozen in the cached snapshot', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'reddix-health-'));
    // A large TTL means the first snapshot would normally be reused verbatim;
    // the live client count must still be reflected on the second call.
    const base = await start(dataDir, { healthCacheTtlMs: 30_000 });

    const first = (await (await fetch(`${base}/api/health`)).json()) as { sseClients: number };
    expect(first.sseClients).toBe(0);

    const sse = await openSse(`${base}/events`);
    try {
      const second = (await (await fetch(`${base}/api/health`)).json()) as { sseClients: number };
      expect(second.sseClients).toBe(1);
    } finally {
      sse.close();
    }
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
