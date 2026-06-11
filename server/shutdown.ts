import type http from 'node:http';

/**
 * Graceful-shutdown orchestration, extracted from index.ts so the sequencing,
 * idempotency, force-exit failsafe, and fatal-reason redaction are unit-testable
 * without starting a real server or registering handlers on the live process.
 */

export interface ShutdownDeps {
  server: http.Server;
  /** Close SSE clients (and any other long-lived connections). */
  closeClients: () => void;
  /** Signal any tracked CLI child processes to terminate. */
  killChildren: (signal: NodeJS.Signals) => void;
  /** Close the HTTP server, invoking `done` once it has stopped accepting. */
  closeServer: (server: http.Server, done: () => void) => void;
  /** Terminate the process with the given code (injected for testability). */
  exit: (code: number) => void;
  /** Emit a human-readable shutdown line. */
  log: (message: string) => void;
  /** Hard-exit window if the server does not close in time. */
  forceExitMs: number;
  /** Await in-flight runs before killing CLI children. When omitted, teardown is
   *  synchronous (legacy path); when set, children are killed only AFTER runs drain
   *  (or {@link drainTimeoutMs} elapses), so a flow mid-run is never severed. */
  drainRuns?: () => Promise<void>;
  /** Max time to wait for {@link drainRuns}; must be < forceExitMs. Default 0. */
  drainTimeoutMs?: number;
}

export interface ShutdownController {
  /** Idempotent: the first call wins; later calls are no-ops. */
  shutdown: (reason: string, exitCode?: number) => void;
  isShuttingDown: () => boolean;
}

export function createShutdown(deps: ShutdownDeps): ShutdownController {
  let shuttingDown = false;
  const shutdown = (reason: string, exitCode = 0): void => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    deps.log(`[reddix] shutting down (${reason})`);
    // Failsafe first: force exit if drain/close stalls. Unref'd so it never keeps
    // the process alive on its own.
    const timer = setTimeout(() => {
      deps.killChildren('SIGKILL');
      deps.exit(exitCode);
    }, deps.forceExitMs);
    if (typeof timer.unref === 'function') {
      timer.unref();
    }

    const drainRuns = deps.drainRuns;
    if (!drainRuns) {
      // Legacy synchronous teardown (no drain configured): unchanged ordering.
      deps.closeClients();
      deps.killChildren('SIGTERM');
      deps.closeServer(deps.server, () => deps.exit(exitCode));
      return;
    }

    // Drain-aware teardown: stop accepting new work, let in-flight runs finish
    // (bounded), THEN kill any straggler children and close the server. Killing
    // children before the drain would sever a flow mid-run and record a spurious
    // failure; draining first lets each run persist its real result.
    void (async () => {
      deps.closeClients();
      try {
        await withTimeout(drainRuns(), deps.drainTimeoutMs ?? 0);
      } catch {
        // A drain failure must never block teardown.
      }
      deps.killChildren('SIGTERM');
      deps.closeServer(deps.server, () => deps.exit(exitCode));
    })();
  };
  return { shutdown, isShuttingDown: () => shuttingDown };
}

/**
 * Resolve when `promise` settles or `ms` elapses, whichever comes first. A
 * non-positive `ms` waits for the promise with no timeout. The timer is unref'd
 * so it never holds the event loop open.
 */
function withTimeout(promise: Promise<unknown>, ms: number): Promise<void> {
  if (ms <= 0) {
    return promise.then(() => undefined);
  }
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    if (typeof timer.unref === 'function') {
      timer.unref();
    }
    const done = (): void => {
      clearTimeout(timer);
      resolve();
    };
    promise.then(done, done);
  });
}

/**
 * Render a fatal reason for logging: prefer an Error's stack, fall back to its
 * message, then to the raw string / String(value). The result is passed through
 * `redact` so secrets in a stack/message never reach the logs.
 */
export function formatFatalReason(reason: unknown, redact: (message: string) => string): string {
  const message =
    reason instanceof Error
      ? reason.stack ?? reason.message
      : typeof reason === 'string'
        ? reason
        : String(reason);
  return redact(message);
}

export interface FatalSignalDeps {
  shutdown: (reason: string, exitCode?: number) => void;
  formatFatalReason: (reason: unknown) => string;
  errorLog: (message: string) => void;
}

/**
 * Wire SIGTERM/SIGINT (graceful, exit 0) and uncaughtException/unhandledRejection
 * (log the redacted reason, then shut down with exit 1) onto an event emitter —
 * the real `process` in production, a fake one in tests.
 */
export function registerFatalSignalHandlers(proc: NodeJS.EventEmitter, deps: FatalSignalDeps): void {
  proc.on('SIGTERM', () => deps.shutdown('SIGTERM'));
  proc.on('SIGINT', () => deps.shutdown('SIGINT'));
  proc.on('uncaughtException', (error) => {
    deps.errorLog(`[reddix] uncaughtException: ${deps.formatFatalReason(error)}`);
    deps.shutdown('uncaughtException', 1);
  });
  proc.on('unhandledRejection', (reason) => {
    deps.errorLog(`[reddix] unhandledRejection: ${deps.formatFatalReason(reason)}`);
    deps.shutdown('unhandledRejection', 1);
  });
}
