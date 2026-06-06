import { describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { errorHandler } from '../server/errorHandler';

function mockResponse(headersSent = false): Response {
  const response = {
    headersSent,
    statusCode: 200,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json: vi.fn()
  };
  return response as unknown as Response;
}

describe('errorHandler', () => {
  it('returns a generic 500 without leaking error internals', () => {
    const response = mockResponse();
    const next = vi.fn() as unknown as NextFunction;
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    errorHandler(new Error('SECRET token=abc123 stack details'), {} as Request, response, next);

    expect(response.statusCode).toBe(500);
    expect(response.json).toHaveBeenCalledWith({ error: 'Internal server error' });
    const payload = JSON.stringify((response.json as ReturnType<typeof vi.fn>).mock.calls);
    expect(payload).not.toContain('SECRET');
    expect(payload).not.toContain('abc123');
    expect(next).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('delegates to next when headers were already sent', () => {
    const response = mockResponse(true);
    const next = vi.fn() as unknown as NextFunction;
    const error = new Error('boom');

    errorHandler(error, {} as Request, response, next);

    expect(next).toHaveBeenCalledWith(error);
    expect(response.json).not.toHaveBeenCalled();
  });
});
