import path from 'node:path';
import { createApp } from './app';
import { validateEnv, summarizeAuthPresence } from './env';
import { buildSecretMap, redactSecrets } from '../src/shared/redaction';
import { killAllCliChildren } from './executor';
import { createLogger } from './logger';
import { createMetrics } from './metrics';
import { closeServer } from './serverLifecycle';
import { createStorage } from './storage';

/** Hard-kill the process if a graceful shutdown stalls past this window. */
const SHUTDOWN_FORCE_EXIT_MS = 10_000;

const { port, dataDir } = validateEnv(process.env);
const logger = createLogger();
const metrics = createMetrics();
logger.info('server.config', {
  port,
  dataDir,
  auth: summarizeAuthPresence(process.env)
});
// One logger/metrics instance shared across storage and the app so every layer
// emits to the same stream and counters accumulate in one registry.
const storage = createStorage({ baseDir: dataDir, logger });
const staticDir = process.env.REDDIX_STATIC_DIR ?? path.join(process.cwd(), 'dist');
const fatalLogSecrets = buildSecretMap(process.env);

const { app, closeClients } = createApp({ storage, dataDir, staticDir, logger, metrics });

// Bind to loopback by default (local single-user). Set HOST=0.0.0.0 only for
// containerized runs where the port is mapped back to the host; CORS allowlist
// and the CSRF guard still constrain cross-origin access.
const host = process.env.HOST ?? '127.0.0.1';

const server = app.listen(port, host, () => {
  console.log(`Reddix backend listening on http://${host}:${port}`);
});
server.on('error', (error) => {
  if (shuttingDown) {
    return;
  }
  console.error('[reddix] server error:', formatFatalReason(error));
  shutdown('server error', 1);
});

let shuttingDown = false;

function shutdown(reason: string, exitCode = 0): void {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  console.log(`[reddix] shutting down (${reason})`);
  closeClients();
  killAllCliChildren('SIGTERM');
  closeServer(server, () => {
    process.exit(exitCode);
  });
  // Failsafe: force exit if the server does not close in time.
  const timer = setTimeout(() => process.exit(exitCode), SHUTDOWN_FORCE_EXIT_MS);
  timer.unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('uncaughtException', (error) => {
  console.error('[reddix] uncaughtException:', formatFatalReason(error));
  shutdown('uncaughtException', 1);
});

process.on('unhandledRejection', (reason) => {
  console.error('[reddix] unhandledRejection:', formatFatalReason(reason));
  shutdown('unhandledRejection', 1);
});

function formatFatalReason(reason: unknown): string {
  const message =
    reason instanceof Error ? reason.stack ?? reason.message : typeof reason === 'string' ? reason : String(reason);
  return redactSecrets(message, fatalLogSecrets);
}
