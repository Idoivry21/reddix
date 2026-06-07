import path from 'node:path';
import { createApp } from './app';
import { validateEnv, summarizeAuthPresence } from './env';
import { buildSecretMap, redactSecrets } from '../src/shared/redaction';
import { createStorage } from './storage';

const { port, dataDir } = validateEnv(process.env);
console.log(`[reddix] auth tokens: ${summarizeAuthPresence(process.env)}`);
const storage = createStorage({ baseDir: dataDir });
const staticDir = process.env.REDDIX_STATIC_DIR ?? path.join(process.cwd(), 'dist');
const fatalLogSecrets = buildSecretMap(process.env);

const { app, closeClients } = createApp({ storage, dataDir, staticDir });

// Bind to loopback by default (local single-user). Set HOST=0.0.0.0 only for
// containerized runs where the port is mapped back to the host; CORS allowlist
// and the CSRF guard still constrain cross-origin access.
const host = process.env.HOST ?? '127.0.0.1';

const server = app.listen(port, host, () => {
  console.log(`Reddix backend listening on http://${host}:${port}`);
});

let shuttingDown = false;

function shutdown(reason: string, exitCode = 0): void {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  console.log(`[reddix] shutting down (${reason})`);
  closeClients();
  server.close(() => {
    process.exit(exitCode);
  });
  // Failsafe: force exit if the server does not close in time.
  const timer = setTimeout(() => process.exit(exitCode), 10_000);
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
