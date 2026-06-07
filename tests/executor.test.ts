// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { resolveMaxOutputBytes, spawnCapped } from '../server/executor';

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
});
