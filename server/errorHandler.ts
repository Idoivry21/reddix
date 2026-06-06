import type { NextFunction, Request, Response } from 'express';

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
