import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { buildCorsOptions } from './cors';
import { csrfGuard } from './csrfGuard';
import { errorHandler } from './errorHandler';
import { createRoutes } from './routes';
import { createStorage } from './storage';

const app = express();
const port = Number(process.env.PORT ?? 8787);
const dataDir = process.env.REDDIX_DATA_DIR ?? path.join(process.cwd(), '.reddix-data');
const storage = createStorage({ baseDir: dataDir });

const { router, eventsHandler, closeClients } = createRoutes({ storage, dataDir });

app.use(cors(buildCorsOptions(process.env)));
app.use(csrfGuard);
app.use(express.json({ limit: '2mb' }));
app.get('/events', eventsHandler);
app.use('/api', router);
app.use(errorHandler);

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
