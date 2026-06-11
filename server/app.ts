import { existsSync } from 'node:fs';
import path from 'node:path';
import express from 'express';
import cors from 'cors';
import { buildCorsOptions } from './cors';
import { createCsrfGuard } from './csrfGuard';
import { createHostGuard } from './hostGuard';
import { createErrorHandler } from './errorHandler';
import { createLogger, type Logger } from './logger';
import { createMetrics, type Metrics } from './metrics';
import { createRoutes } from './routes';
import type { createStorage } from './storage';

/** Max accepted request body — caps the size of a flow definition that can be PUT. */
const JSON_BODY_LIMIT = '2mb';

interface CreateAppOptions {
  storage: ReturnType<typeof createStorage>;
  dataDir: string;
  /** When set and present on disk, the built SPA is served from here. */
  staticDir?: string;
  /** Shared logger; created if not supplied (and shared with storage in index). */
  logger?: Logger;
  /** Shared metrics registry; created if not supplied. */
  metrics?: Metrics;
  providerHealthChecker?: (executable: 'rdt' | 'twitter') => Promise<boolean>;
  healthCacheTtlMs?: number;
  healthMinIntervalMs?: number;
}

export interface CreatedApp {
  app: express.Express;
  closeClients: () => void;
  /** Await in-flight runs during graceful shutdown before CLI children are killed. */
  drainRuns: () => Promise<void>;
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
  const { router, eventsHandler, closeClients, drainRuns } = createRoutes({
    storage: options.storage,
    dataDir: options.dataDir,
    logger,
    metrics,
    providerHealthChecker: options.providerHealthChecker,
    healthCacheTtlMs: options.healthCacheTtlMs,
    healthMinIntervalMs: options.healthMinIntervalMs
  });

  app.use(logger.requestLogger());
  // Reject non-loopback Host headers before any other work (DNS-rebind defense,
  // finding #1); CORS/CSRF below are unchanged.
  app.use(createHostGuard(process.env, logger));
  app.use(cors(buildCorsOptions(process.env)));
  app.use(createCsrfGuard(logger));
  app.use(express.json({ limit: JSON_BODY_LIMIT }));
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
  return { app, closeClients, drainRuns };
}
