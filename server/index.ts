import path from 'node:path';
import { createApp } from './app';
import { validateEnv, summarizeAuthPresence } from './env';
import { createStorage } from './storage';

const { port, dataDir } = validateEnv(process.env);
console.log(`[reddix] auth tokens: ${summarizeAuthPresence(process.env)}`);
const storage = createStorage({ baseDir: dataDir });
const staticDir = process.env.REDDIX_STATIC_DIR ?? path.join(process.cwd(), 'dist');

const { app, closeClients } = createApp({ storage, dataDir, staticDir });

const server = app.listen(port, '127.0.0.1', () => {
  console.log(`Reddix backend listening on http://127.0.0.1:${port}`);
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
  console.error('[reddix] uncaughtException:', error);
  shutdown('uncaughtException', 1);
});

process.on('unhandledRejection', (reason) => {
  console.error('[reddix] unhandledRejection:', reason);
  shutdown('unhandledRejection', 1);
});
