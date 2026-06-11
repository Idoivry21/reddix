// @vitest-environment node

import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.doUnmock('node:child_process');
  vi.resetModules();
});

describe('spawnCapped child stream safety', () => {
  it('registers error listeners on child stdout and stderr streams', async () => {
    const stdout = new EventEmitter();
    const stderr = new EventEmitter();
    const child = Object.assign(new EventEmitter(), {
      stdout,
      stderr,
      kill: vi.fn()
    });
    const spawn = vi.fn(() => child);

    vi.doMock('node:child_process', async (importOriginal) => {
      const actual = await importOriginal<typeof import('node:child_process')>();
      return { ...actual, spawn };
    });

    const { spawnCapped } = await import('../server/executor');
    const promise = spawnCapped('cmd', [], { env: {}, maxOutputBytes: 1000, timeoutMs: 1_000 });
    const stdoutErrorListeners = stdout.listenerCount('error');
    const stderrErrorListeners = stderr.listenerCount('error');
    child.emit('close', 0);

    await expect(promise).resolves.toMatchObject({ exitCode: 0 });
    expect(stdoutErrorListeners).toBeGreaterThan(0);
    expect(stderrErrorListeners).toBeGreaterThan(0);
  });
});
