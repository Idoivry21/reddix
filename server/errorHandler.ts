import type { ErrorRequestHandler, NextFunction, Request, Response } from 'express';
import { nanoid } from 'nanoid';
import { buildSecretMap, redactSecrets } from '../src/shared/redaction';

interface ErrorLogger {
  error: (message: string, fields?: Record<string, unknown>) => void;
}

/**
 * Terminal Express error middleware. Returns a safe, generic JSON error and
 * never leaks stack traces, messages, or other internals to the client.
 * Detailed context is logged server-side only.
 */
export function errorHandler(
  error: unknown,
  _request: Request,
  response: Response,
  next: NextFunction
): void {
  // If the response has already started streaming (e.g. SSE), defer to the
  // default Express handler which will close the connection.
  if (response.headersSent) {
    next(error);
    return;
  }
  // Redact before logging: a CLI-originated error may echo an auth token in its
  // message, and this fallback path does not go through the redacting logger.
  const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
  console.error(
    '[reddix] unhandled request error:',
    redactSecrets(detail, buildSecretMap(process.env))
  );
  response.status(500).json({ error: 'Internal server error' });
}

/**
 * Like {@link errorHandler} but routes server-side detail through a
 * secret-redacting structured logger instead of raw console.error.
 */
export function createErrorHandler(logger: ErrorLogger): ErrorRequestHandler {
  return (error, request, response, next) => {
    if (response.headersSent) {
      next(error);
      return;
    }
    // Correlate the client-facing 500 with the server log via a request id, so a
    // user/support ticket can point straight at the matching log entry.
    const requestId = nanoid();
    logger.error('request error', {
      requestId,
      path: request.path,
      detail: error instanceof Error ? error.message : String(error)
    });
    response.status(500).json({ error: 'Internal server error', code: 'INTERNAL_ERROR', requestId });
  };
}
