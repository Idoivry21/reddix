import { existsSync } from 'node:fs';
import path from 'node:path';
import express from 'express';
import cors from 'cors';
import { buildCorsOptions } from './cors';
import { createCsrfGuard } from './csrfGuard';
import { createErrorHandler } from './errorHandler';
import { createLogger, type Logger } from './logger';
import { createMetrics, type Metrics } from './metrics';
import { createRoutes } from './routes';
import type { createStorage } from './storage';

interface CreateAppOptions {
  storage: ReturnType<typeof createStorage>;
  dataDir: string;
  /** When set and present on disk, the built SPA is served from here. */
  staticDir?: string;
  /** Shared logger; created if not supplied (and shared with storage in index). */
  logger?: Logger;
  /** Shared metrics registry; created if not supplied. */
  metrics?: Metrics;
}

export interface CreatedApp {
  app: express.Express;
  closeClients: () => void;
}

/**
 * Build the Express app: CORS + CSRF guard, JSON body limit, the root SSE
 * endpoint, the /api router, optional static SPA serving, then the terminal
 * error handler. Separated from server start so it can be smoke-tested.
 */
export function createApp(options: CreateAppOptions): CreatedApp {
  const app = express();
  const logger = options.logger ?? createLogger();
  const metrics = options.metrics ?? createMetrics();
  const { router, eventsHandler, closeClients } = createRoutes({
    storage: options.storage,
    dataDir: options.dataDir,
    logger,
    metrics
  });

  app.use(logger.requestLogger());
  app.use(cors(buildCorsOptions(process.env)));
  app.use(createCsrfGuard(logger));
  app.use(express.json({ limit: '2mb' }));
  app.get('/events', eventsHandler);
  app.use('/api', router);

  if (options.staticDir && existsSync(options.staticDir)) {
    const staticDir = options.staticDir;
    app.use(express.static(staticDir));
    // SPA fallback: serve index.html for client-side GET routes that are not
    // API or SSE endpoints.
    app.use((request, response, next) => {
      if (request.method !== 'GET' || request.path.startsWith('/api') || request.path === '/events') {
        next();
        return;
      }
      response.sendFile(path.join(staticDir, 'index.html'));
    });
  }

  app.use(createErrorHandler(logger));
  return { app, closeClients };
}
