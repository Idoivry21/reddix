import path from 'node:path';
import { createApp } from './app';
import { validateEnv, summarizeAuthPresence } from './env';
import { buildSecretMap, redactSecrets } from '../src/shared/redaction';
import { killAllCliChildren } from './executor';
import { createLogger } from './logger';
import { createMetrics } from './metrics';
import { closeServer } from './serverLifecycle';
import { createShutdown, formatFatalReason, registerFatalSignalHandlers } from './shutdown';
import { createStorage } from './storage';

/** Hard-kill the process if a graceful shutdown stalls past this window. */
const SHUTDOWN_FORCE_EXIT_MS = 10_000;
/** Time given to in-flight runs to finish before children are killed. Must be
 *  comfortably under {@link SHUTDOWN_FORCE_EXIT_MS} so kill + close still fit. */
const SHUTDOWN_DRAIN_TIMEOUT_MS = 7_000;

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

const { app, closeClients, drainRuns } = createApp({ storage, dataDir, staticDir, logger, metrics });

// Bind to loopback by default (local single-user). Set HOST=0.0.0.0 only for
// containerized runs where the port is mapped back to the host; CORS allowlist
// and the CSRF guard still constrain cross-origin access.
const host = process.env.HOST ?? '127.0.0.1';

const server = app.listen(port, host, () => {
  console.log(`Reddix backend listening on http://${host}:${port}`);
});
const redactFatal = (message: string): string => redactSecrets(message, fatalLogSecrets);

const { shutdown, isShuttingDown } = createShutdown({
  server,
  closeClients,
  drainRuns,
  drainTimeoutMs: SHUTDOWN_DRAIN_TIMEOUT_MS,
  killChildren: killAllCliChildren,
  closeServer,
  exit: (code) => process.exit(code),
  log: (message) => console.log(message),
  forceExitMs: SHUTDOWN_FORCE_EXIT_MS
});

server.on('error', (error) => {
  if (isShuttingDown()) {
    return;
  }
  console.error('[reddix] server error:', formatFatalReason(error, redactFatal));
  shutdown('server error', 1);
});

registerFatalSignalHandlers(process, {
  shutdown,
  formatFatalReason: (reason) => formatFatalReason(reason, redactFatal),
  errorLog: (message) => console.error(message)
});
