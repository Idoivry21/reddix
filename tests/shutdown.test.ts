// @vitest-environment node

import { EventEmitter } from 'node:events';
import type http from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createShutdown,
  formatFatalReason,
  registerFatalSignalHandlers,
  type ShutdownDeps
} from '../server/shutdown';

const fakeServer = {} as http.Server;

function deps(overrides: Partial<ShutdownDeps> = {}): { deps: ShutdownDeps; calls: Record<string, ReturnType<typeof vi.fn>> } {
  const calls = {
    closeClients: vi.fn(),
    killChildren: vi.fn(),
    closeServer: vi.fn((_server: http.Server, done: () => void) => done()),
    exit: vi.fn(),
    log: vi.fn()
  };
  return {
    calls,
    deps: {
      server: fakeServer,
      closeClients: calls.closeClients,
      killChildren: calls.killChildren,
      closeServer: calls.closeServer,
      exit: calls.exit,
      log: calls.log,
      forceExitMs: 10_000,
      ...overrides
    }
  };
}

describe('createShutdown', () => {
  it('runs the shutdown sequence and exits with the given code', () => {
    const { deps: d, calls } = deps();
    const { shutdown } = createShutdown(d);

    shutdown('SIGTERM', 0);

    expect(calls.log).toHaveBeenCalledWith('[reddix] shutting down (SIGTERM)');
    expect(calls.closeClients).toHaveBeenCalledTimes(1);
    expect(calls.killChildren).toHaveBeenCalledWith('SIGTERM');
    expect(calls.closeServer).toHaveBeenCalledWith(fakeServer, expect.any(Function));
    // closeServer's done() callback drives the exit with the requested code.
    expect(calls.exit).toHaveBeenCalledWith(0);
  });

  it('passes a nonzero exit code through to exit()', () => {
    const { deps: d, calls } = deps();
    createShutdown(d).shutdown('uncaughtException', 1);
    expect(calls.exit).toHaveBeenCalledWith(1);
  });

  it('is idempotent — a second call is a no-op', () => {
    const { deps: d, calls } = deps();
    const { shutdown, isShuttingDown } = createShutdown(d);

    expect(isShuttingDown()).toBe(false);
    shutdown('SIGTERM');
    expect(isShuttingDown()).toBe(true);
    shutdown('SIGINT');

    expect(calls.closeClients).toHaveBeenCalledTimes(1);
    expect(calls.closeServer).toHaveBeenCalledTimes(1);
    expect(calls.exit).toHaveBeenCalledTimes(1);
  });

  it('drains in-flight runs before killing CLI children when drainRuns is provided', async () => {
    let releaseDrain!: () => void;
    const drainGate = new Promise<void>((resolve) => {
      releaseDrain = resolve;
    });
    const drainRuns = vi.fn(() => drainGate);
    const { deps: d, calls } = deps({ drainRuns, drainTimeoutMs: 5_000 });

    createShutdown(d).shutdown('SIGTERM', 0);

    // Synchronously: clients closed and drain started, but children NOT yet killed
    // and the server not yet closed — they wait for the drain.
    expect(calls.closeClients).toHaveBeenCalledTimes(1);
    expect(drainRuns).toHaveBeenCalledTimes(1);
    expect(calls.killChildren).not.toHaveBeenCalled();
    expect(calls.closeServer).not.toHaveBeenCalled();

    releaseDrain();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(calls.killChildren).toHaveBeenCalledWith('SIGTERM');
    expect(calls.closeServer).toHaveBeenCalledTimes(1);
    expect(calls.exit).toHaveBeenCalledWith(0);
  });

  it('kills children even if the drain never resolves, bounded by the drain timeout', async () => {
    const drainRuns = vi.fn(() => new Promise<void>(() => {})); // never resolves
    const { deps: d, calls } = deps({ drainRuns, drainTimeoutMs: 5 });

    createShutdown(d).shutdown('SIGTERM', 0);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(calls.killChildren).toHaveBeenCalledWith('SIGTERM');
    expect(calls.exit).toHaveBeenCalledWith(0);
  });

  it('force-exits after forceExitMs when the server never finishes closing', () => {
    vi.useFakeTimers();
    try {
      // closeServer ignores its done callback -> only the failsafe timer can exit.
      const { deps: d, calls } = deps({ closeServer: vi.fn(), forceExitMs: 5_000 });
      createShutdown(d).shutdown('SIGTERM', 2);

      expect(calls.exit).not.toHaveBeenCalled();
      vi.advanceTimersByTime(5_000);
      expect(calls.killChildren).toHaveBeenCalledWith('SIGKILL');
      expect(calls.exit).toHaveBeenCalledWith(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('formatFatalReason', () => {
  const redact = (message: string): string => message.replace(/SECRET\w+/g, '[redacted]');

  it('prefers an Error stack and applies redaction', () => {
    const error = new Error('boom with SECRETtoken123');
    const formatted = formatFatalReason(error, redact);
    expect(formatted).toContain('boom with [redacted]');
    expect(formatted).not.toContain('SECRETtoken123');
  });

  it('falls back to the Error message when there is no stack', () => {
    const error = new Error('no stack here');
    error.stack = undefined;
    expect(formatFatalReason(error, (m) => m)).toBe('no stack here');
  });

  it('passes a raw string through', () => {
    expect(formatFatalReason('plain reason', (m) => m)).toBe('plain reason');
  });

  it('coerces a non-Error, non-string value via String()', () => {
    expect(formatFatalReason({ code: 42 }, (m) => m)).toBe('[object Object]');
  });
});

describe('registerFatalSignalHandlers', () => {
  let proc: EventEmitter;

  afterEach(() => {
    proc?.removeAllListeners();
  });

  it('shuts down gracefully (exit 0) on SIGTERM and SIGINT', () => {
    proc = new EventEmitter();
    const shutdown = vi.fn();
    registerFatalSignalHandlers(proc, { shutdown, formatFatalReason: (r) => String(r), errorLog: vi.fn() });

    proc.emit('SIGTERM');
    proc.emit('SIGINT');

    expect(shutdown).toHaveBeenNthCalledWith(1, 'SIGTERM');
    expect(shutdown).toHaveBeenNthCalledWith(2, 'SIGINT');
  });

  it('logs the redacted reason and shuts down with exit 1 on uncaughtException', () => {
    proc = new EventEmitter();
    const shutdown = vi.fn();
    const errorLog = vi.fn();
    registerFatalSignalHandlers(proc, {
      shutdown,
      formatFatalReason: () => 'FORMATTED',
      errorLog
    });

    proc.emit('uncaughtException', new Error('kaboom'));

    expect(errorLog).toHaveBeenCalledWith('[reddix] uncaughtException: FORMATTED');
    expect(shutdown).toHaveBeenCalledWith('uncaughtException', 1);
  });

  it('logs and shuts down with exit 1 on unhandledRejection', () => {
    proc = new EventEmitter();
    const shutdown = vi.fn();
    const errorLog = vi.fn();
    registerFatalSignalHandlers(proc, {
      shutdown,
      formatFatalReason: () => 'REASON',
      errorLog
    });

    proc.emit('unhandledRejection', 'rejected');

    expect(errorLog).toHaveBeenCalledWith('[reddix] unhandledRejection: REASON');
    expect(shutdown).toHaveBeenCalledWith('unhandledRejection', 1);
  });
});
