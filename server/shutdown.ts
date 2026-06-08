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
    deps.closeClients();
    deps.killChildren('SIGTERM');
    deps.closeServer(deps.server, () => deps.exit(exitCode));
    // Failsafe: force exit if the server does not close in time.
    const timer = setTimeout(() => deps.exit(exitCode), deps.forceExitMs);
    if (typeof timer.unref === 'function') {
      timer.unref();
    }
  };
  return { shutdown, isShuttingDown: () => shuttingDown };
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
