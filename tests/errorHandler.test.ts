// @vitest-environment node

import type { NextFunction, Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { createErrorHandler } from '../server/errorHandler';

/**
 * Tests the CURRENT createErrorHandler(logger) API. The pre-refactor
 * errorHandler.test.ts was deleted (commit f004eb2) when the export changed
 * from `errorHandler` to `createErrorHandler` and the envelope gained
 * `code`/`requestId`; these tests cover the new contract.
 */

interface JsonResponse extends Response {
  jsonBody: unknown;
}

function mockResponse(headersSent = false): JsonResponse {
  const response = {
    headersSent,
    statusCode: 200,
    jsonBody: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json: vi.fn(function (this: { jsonBody: unknown }, body: unknown) {
      this.jsonBody = body;
      return this;
    })
  };
  return response as unknown as JsonResponse;
}

function mockLogger() {
  return { error: vi.fn() };
}

describe('createErrorHandler', () => {
  it('returns a generic 500 envelope with a requestId and never leaks the error message to the client', () => {
    const logger = mockLogger();
    const response = mockResponse();
    const next = vi.fn() as unknown as NextFunction;

    createErrorHandler(logger)(
      new Error('SECRET token=abc123 internal stack detail'),
      { path: '/api/flows/x' } as Request,
      response,
      next
    );

    expect(response.statusCode).toBe(500);
    expect(response.jsonBody).toMatchObject({ error: 'Internal server error', code: 'INTERNAL_ERROR' });
    expect(typeof (response.jsonBody as { requestId: unknown }).requestId).toBe('string');
    const payload = JSON.stringify(response.jsonBody);
    expect(payload).not.toContain('SECRET');
    expect(payload).not.toContain('abc123');
    expect(payload).not.toContain('stack');
    expect(next).not.toHaveBeenCalled();
  });

  it('routes the error detail and request path through the injected logger', () => {
    const logger = mockLogger();
    const response = mockResponse();

    createErrorHandler(logger)(
      new Error('boom detail'),
      { path: '/api/runs' } as Request,
      response,
      vi.fn() as unknown as NextFunction
    );

    expect(logger.error).toHaveBeenCalledTimes(1);
    const [operation, fields] = logger.error.mock.calls[0];
    expect(operation).toBe('request error');
    expect(fields).toMatchObject({ path: '/api/runs', detail: 'boom detail' });
  });

  it('correlates the client requestId with the logged requestId', () => {
    const logger = mockLogger();
    const response = mockResponse();

    createErrorHandler(logger)(
      new Error('x'),
      { path: '/api/flows' } as Request,
      response,
      vi.fn() as unknown as NextFunction
    );

    const clientRequestId = (response.jsonBody as { requestId: string }).requestId;
    const loggedRequestId = (logger.error.mock.calls[0][1] as { requestId: string }).requestId;
    expect(loggedRequestId).toBe(clientRequestId);
  });

  it('delegates to next() and writes nothing when headers were already sent', () => {
    const logger = mockLogger();
    const response = mockResponse(true);
    const next = vi.fn() as unknown as NextFunction;
    const error = new Error('late error');

    createErrorHandler(logger)(error, { path: '/api/x' } as Request, response, next);

    expect(next).toHaveBeenCalledWith(error);
    expect(response.json).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('coerces a non-Error throwable to a string detail', () => {
    const logger = mockLogger();
    const response = mockResponse();

    createErrorHandler(logger)(
      'plain string failure' as unknown as Error,
      { path: '/api/x' } as Request,
      response,
      vi.fn() as unknown as NextFunction
    );

    expect((logger.error.mock.calls[0][1] as { detail: string }).detail).toBe('plain string failure');
    expect(response.statusCode).toBe(500);
  });
});
