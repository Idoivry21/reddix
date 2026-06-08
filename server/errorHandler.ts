import type { ErrorRequestHandler } from 'express';
import { nanoid } from 'nanoid';
import type { EventLogger } from './logger';

/**
 * Terminal Express error middleware. Returns a safe, generic JSON error (never
 * leaking stack traces or internals to the client) and routes server-side detail
 * through the secret-redacting structured logger. Correlates the client-facing
 * 500 with the server log via a request id.
 */
export function createErrorHandler(logger: Pick<EventLogger, 'error'>): ErrorRequestHandler {
  return (error, request, response, next) => {
    if (response.headersSent) {
      next(error);
      return;
    }
    // Correlate the client-facing 500 with the server log via a request id, so a
    // user/support ticket can point straight at the matching log entry.
    const requestId = nanoid();
    const stack = error instanceof Error && error.stack ? error.stack : undefined;
    logger.error('request error', {
      requestId,
      path: request.path,
      detail: error instanceof Error ? error.message : String(error),
      ...(stack ? { stack } : {})
    });
    response.status(500).json({ error: 'Internal server error', code: 'INTERNAL_ERROR', requestId });
  };
}
