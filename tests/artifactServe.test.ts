// @vitest-environment node

import http from 'node:http';
import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises';
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

async function start(): Promise<{ base: string; dataDir: string }> {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'reddix-artifact-'));
  const { app } = createApp({ storage: createStorage({ baseDir: dataDir }), dataDir });
  const base = await new Promise<string>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      const address = server!.address() as AddressInfo;
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
  return { base, dataDir };
}

describe('GET /api/artifacts/*', () => {
  it('serves a contained HTML artifact with the html content type', async () => {
    const { base, dataDir } = await start();
    await mkdir(path.join(dataDir, 'artifacts', 'outputs'), { recursive: true });
    await writeFile(path.join(dataDir, 'artifacts', 'outputs', 'report.html'), '<!doctype html><title>R</title>');

    const response = await fetch(`${base}/api/artifacts/outputs/report.html`);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(await response.text()).toContain('<!doctype html>');
  });

  it('sets defense-in-depth headers on served HTML artifacts', async () => {
    const { base, dataDir } = await start();
    await mkdir(path.join(dataDir, 'artifacts', 'outputs'), { recursive: true });
    await writeFile(path.join(dataDir, 'artifacts', 'outputs', 'report.html'), '<!doctype html><title>R</title>');

    const response = await fetch(`${base}/api/artifacts/outputs/report.html`);

    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('content-security-policy')).toContain("default-src 'none'");
  });

  it('refuses to follow a symlink that escapes the artifacts directory', async () => {
    const { base, dataDir } = await start();
    await mkdir(path.join(dataDir, 'artifacts'), { recursive: true });
    await writeFile(path.join(dataDir, 'secret.txt'), 'TOPSECRET');
    await symlink(path.join(dataDir, 'secret.txt'), path.join(dataDir, 'artifacts', 'leak.txt'));

    const response = await fetch(`${base}/api/artifacts/leak.txt`);

    expect(response.status).not.toBe(200);
    expect(await response.text()).not.toContain('TOPSECRET');
  });

  it('serves a JSON artifact with the json content type', async () => {
    const { base, dataDir } = await start();
    await mkdir(path.join(dataDir, 'artifacts', 'outputs'), { recursive: true });
    await writeFile(path.join(dataDir, 'artifacts', 'outputs', 'data.json'), '{"ok":true}');

    const response = await fetch(`${base}/api/artifacts/outputs/data.json`);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
  });

  it('returns 404 for a missing artifact', async () => {
    const { base } = await start();
    const response = await fetch(`${base}/api/artifacts/outputs/missing.html`);
    expect(response.status).toBe(404);
  });

  it('rejects path traversal and never leaks files outside the artifacts dir', async () => {
    const { base, dataDir } = await start();
    await writeFile(path.join(dataDir, 'secret.txt'), 'TOPSECRET');

    const response = await fetch(`${base}/api/artifacts/..%2fsecret.txt`);

    expect(response.status).not.toBe(200);
    expect(await response.text()).not.toContain('TOPSECRET');
  });

  it('rejects overlong artifact paths before filesystem lookup', async () => {
    const { base } = await start();
    const longName = 'a'.repeat(2100);

    const response = await fetch(`${base}/api/artifacts/${longName}`);

    expect(response.status).toBe(400);
  });

  it('streams artifacts larger than 10 MiB instead of writing unreachable files', async () => {
    const { base, dataDir } = await start();
    await mkdir(path.join(dataDir, 'artifacts', 'outputs'), { recursive: true });
    await writeFile(path.join(dataDir, 'artifacts', 'outputs', 'large.txt'), Buffer.alloc(10 * 1024 * 1024 + 1, 65));

    const response = await fetch(`${base}/api/artifacts/outputs/large.txt`);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-length')).toBe(String(10 * 1024 * 1024 + 1));
    expect((await response.arrayBuffer()).byteLength).toBe(10 * 1024 * 1024 + 1);
  });
});
