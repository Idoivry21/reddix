// @vitest-environment node

import { describe, expect, it } from 'vitest';
import {
  buildCliEnv,
  checkExecutable,
  resolveCliTimeoutMs,
  spawnCapped
} from '../server/executor';
import { AUTH_ENV_KEYS } from '../src/shared/redaction';

const NONEXISTENT_BINARY = 'reddix-no-such-binary-xyz-123';

describe('buildCliEnv (least-privilege env allowlist)', () => {
  it('passes through only PATH/HOME/TMPDIR plus the allowlisted auth keys', () => {
    const env = buildCliEnv({
      PATH: '/usr/bin',
      HOME: '/home/u',
      TMPDIR: '/tmp',
      TWITTER_AUTH_TOKEN: 'tok',
      TWITTER_CT0: 'ct0',
      AWS_SECRET_ACCESS_KEY: 'leak-me',
      DATABASE_URL: 'postgres://secret',
      RANDOM_VAR: 'x'
    });

    expect(env.PATH).toBe('/usr/bin');
    expect(env.HOME).toBe('/home/u');
    expect(env.TMPDIR).toBe('/tmp');
    for (const key of AUTH_ENV_KEYS) {
      expect(env[key]).toBeDefined();
    }
    // Non-allowlisted variables (including secrets) must never reach the CLI.
    expect(env.AWS_SECRET_ACCESS_KEY).toBeUndefined();
    expect(env.DATABASE_URL).toBeUndefined();
    expect(env.RANDOM_VAR).toBeUndefined();
  });

  it('drops empty-string values so a blank var never overrides a real one downstream', () => {
    const env = buildCliEnv({ PATH: '/usr/bin', HOME: '', TWITTER_AUTH_TOKEN: '' });
    expect(env.PATH).toBe('/usr/bin');
    expect('HOME' in env).toBe(false);
    expect('TWITTER_AUTH_TOKEN' in env).toBe(false);
  });

  it('returns an empty env when nothing is allowlisted', () => {
    expect(buildCliEnv({ FOO: 'bar' })).toEqual({});
  });
});

describe('resolveCliTimeoutMs', () => {
  it('uses a valid positive env override', () => {
    expect(resolveCliTimeoutMs({ REDDIX_CLI_TIMEOUT_MS: '5000' })).toBe(5000);
  });

  it('falls back to the default for missing, non-numeric, zero, or negative values', () => {
    const fallback = resolveCliTimeoutMs({});
    expect(fallback).toBeGreaterThan(0);
    expect(resolveCliTimeoutMs({ REDDIX_CLI_TIMEOUT_MS: 'nope' })).toBe(fallback);
    expect(resolveCliTimeoutMs({ REDDIX_CLI_TIMEOUT_MS: '0' })).toBe(fallback);
    expect(resolveCliTimeoutMs({ REDDIX_CLI_TIMEOUT_MS: '-1' })).toBe(fallback);
  });
});

describe('spawnCapped error and exit-code paths', () => {
  it('resolves with the spawn-error exit code (127) and the OS error message when the binary is missing', async () => {
    const result = await spawnCapped(NONEXISTENT_BINARY, [], {
      env: process.env,
      maxOutputBytes: 1000
    });

    expect(result.exitCode).toBe(127);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('ENOENT');
  });

  it('passes a specific nonzero exit code through unchanged', async () => {
    const result = await spawnCapped(process.execPath, ['-e', 'process.exit(42)'], {
      env: process.env,
      maxOutputBytes: 1000
    });

    expect(result.exitCode).toBe(42);
  });

  it('preserves prior stderr content and appends the truncation reason on overflow', async () => {
    const result = await spawnCapped(
      process.execPath,
      ['-e', "process.stderr.write('real-error-line\\n'); process.stdout.write('y'.repeat(500000));"],
      { env: process.env, maxOutputBytes: 1000 }
    );

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain('real-error-line');
    expect(result.stderr).toContain('output exceeded');
  });

  it('captures stderr written by a process that then exits nonzero', async () => {
    const result = await spawnCapped(
      process.execPath,
      ['-e', "process.stderr.write('boom'); process.exit(3)"],
      { env: process.env, maxOutputBytes: 1000 }
    );

    expect(result.exitCode).toBe(3);
    expect(result.stderr).toBe('boom');
  });
});

describe('checkExecutable', () => {
  it('returns true when the executable runs --help and exits 0', async () => {
    // node --help exits 0; this exercises the real spawn + exit-code-0 path.
    expect(await checkExecutable(process.execPath)).toBe(true);
  });

  it('returns false when the executable cannot be spawned', async () => {
    expect(await checkExecutable(NONEXISTENT_BINARY)).toBe(false);
  });
});
