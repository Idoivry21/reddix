import type { ErrorRequestHandler } from 'express';
import { nanoid } from 'nanoid';
import type { EventLogger } from './logger';

/**
 * Terminal Express error middleware. Returns a safe, generic JSON error (never
 * leaking stack traces or internals to the client) and routes server-side detail
 * through the secret-redacting structured logger. Correlates the client-facing
 * 500 with the server log via a request id.
 */
/**
 * Body-parser failures (malformed or oversized request JSON) are client errors,
 * not server faults — map them to a 4xx with a fixed envelope (never the raw
 * parser message) instead of the generic 500 (finding #20).
 */
const CLIENT_ERROR_ENVELOPES: Record<string, { status: number; error: string; code: string }> = {
  'entity.parse.failed': { status: 400, error: 'Malformed JSON body', code: 'INVALID_JSON' },
  'entity.too.large': { status: 413, error: 'Request body too large', code: 'PAYLOAD_TOO_LARGE' }
};

const STATUS_FALLBACK_ENVELOPES: Record<number, { error: string; code: string }> = {
  400: { error: 'Malformed JSON body', code: 'INVALID_JSON' },
  413: { error: 'Request body too large', code: 'PAYLOAD_TOO_LARGE' }
};

/** Map a thrown value to a client-error envelope when it is a recognized
 *  body-parser failure (by `type`, or a numeric 400/413 `status`/`statusCode`). */
function clientErrorEnvelope(error: unknown): { status: number; error: string; code: string } | null {
  if (typeof error !== 'object' || error === null) {
    return null;
  }
  const { type, status, statusCode } = error as { type?: unknown; status?: unknown; statusCode?: unknown };
  if (typeof type === 'string' && CLIENT_ERROR_ENVELOPES[type]) {
    return CLIENT_ERROR_ENVELOPES[type];
  }
  const numericStatus = typeof status === 'number' ? status : typeof statusCode === 'number' ? statusCode : undefined;
  if (numericStatus !== undefined && STATUS_FALLBACK_ENVELOPES[numericStatus]) {
    return { status: numericStatus, ...STATUS_FALLBACK_ENVELOPES[numericStatus] };
  }
  return null;
}

export function createErrorHandler(logger: Pick<EventLogger, 'error'>): ErrorRequestHandler {
  return (error, request, response, next) => {
    if (response.headersSent) {
      next(error);
      return;
    }
    // Correlate the client-facing response with the server log via a request id,
    // so a user/support ticket can point straight at the matching log entry.
    const requestId = nanoid();
    const stack = error instanceof Error && error.stack ? error.stack : undefined;
    logger.error('request error', {
      requestId,
      path: request.path,
      detail: error instanceof Error ? error.message : String(error),
      ...(stack ? { stack } : {})
    });
    const mapped = clientErrorEnvelope(error);
    if (mapped) {
      response.status(mapped.status).json({ error: mapped.error, code: mapped.code, requestId });
      return;
    }
    response.status(500).json({ error: 'Internal server error', code: 'INTERNAL_ERROR', requestId });
  };
}
