// @vitest-environment node

import { existsSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { killAllCliChildren, resolveMaxOutputBytes, spawnCapped } from '../server/executor';

describe('resolveMaxOutputBytes', () => {
  it('uses the env override when valid', () => {
    expect(resolveMaxOutputBytes({ REDDIX_MAX_OUTPUT_BYTES: '2048' })).toBe(2048);
  });

  it('falls back to the default for invalid values', () => {
    expect(resolveMaxOutputBytes({ REDDIX_MAX_OUTPUT_BYTES: 'nonsense' })).toBeGreaterThan(0);
    expect(resolveMaxOutputBytes({ REDDIX_MAX_OUTPUT_BYTES: '-5' })).toBeGreaterThan(0);
    expect(resolveMaxOutputBytes({})).toBeGreaterThan(0);
  });
});

describe('spawnCapped', () => {
  it('returns full output and exit 0 when under the cap', async () => {
    const result = await spawnCapped(
      process.execPath,
      ['-e', "process.stdout.write('hello')"],
      { env: process.env, maxOutputBytes: 1000 }
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('hello');
    expect(result.stderr).toBe('');
  });

  it('truncates and fails the step when output exceeds the cap', async () => {
    const result = await spawnCapped(
      process.execPath,
      ['-e', "process.stdout.write('x'.repeat(500000))"],
      { env: process.env, maxOutputBytes: 1000 }
    );
    expect(result.exitCode).not.toBe(0);
    expect(Buffer.byteLength(result.stdout, 'utf8')).toBeLessThanOrEqual(1000);
    expect(result.stderr).toContain('output exceeded');
  });

  it('terminates a silent process after the timeout elapses', async () => {
    const started = Date.now();
    const result = await spawnCapped(
      process.execPath,
      ['-e', 'setInterval(() => {}, 1000)'],
      { env: process.env, maxOutputBytes: 1000, timeoutMs: 50 }
    );

    expect(Date.now() - started).toBeLessThan(1000);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain('timed out');
  });

  it('preserves multibyte UTF-8 characters split across stdout chunks', async () => {
    const result = await spawnCapped(
      process.execPath,
      [
        '-e',
        "const b=Buffer.from('😀','utf8'); process.stdout.write(b.subarray(0,2)); setTimeout(() => process.stdout.write(b.subarray(2)), 20);"
      ],
      { env: process.env, maxOutputBytes: 1000 }
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('😀');
  });

  it('kills descendants when a timed-out CLI spawned grandchildren', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'reddix-executor-'));
    const sentinel = path.join(dir, 'grandchild-alive.txt');
    const grandchild = `setTimeout(() => require('node:fs').writeFileSync(${JSON.stringify(
      sentinel
    )}, 'alive'), 300); setInterval(() => {}, 1000);`;
    const parent = `require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(
      grandchild
    )}], { stdio: 'ignore' }); setInterval(() => {}, 1000);`;

    const result = await spawnCapped(process.execPath, ['-e', parent], {
      env: process.env,
      maxOutputBytes: 1000,
      timeoutMs: 50
    });
    await new Promise((resolve) => setTimeout(resolve, 500));

    expect(result.exitCode).not.toBe(0);
    expect(existsSync(sentinel)).toBe(false);
  });

  it('allows shutdown to kill every tracked child process', async () => {
    const promise = spawnCapped(
      process.execPath,
      ['-e', 'setInterval(() => {}, 1000)'],
      { env: process.env, maxOutputBytes: 1000, timeoutMs: 5_000 }
    );
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(killAllCliChildren('SIGKILL')).toBeGreaterThanOrEqual(1);
    const result = await promise;

    expect(result.exitCode).not.toBe(0);
  });
});
