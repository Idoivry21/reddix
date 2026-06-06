import type { ErrorRequestHandler, NextFunction, Request, Response } from 'express';

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
  console.error('[reddix] unhandled request error:', error);
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
    logger.error('request error', {
      path: request.path,
      detail: error instanceof Error ? error.message : String(error)
    });
    response.status(500).json({ error: 'Internal server error' });
  };
}
