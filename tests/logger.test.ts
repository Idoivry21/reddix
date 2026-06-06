import { describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import { createLogger } from '../server/logger';

describe('createLogger', () => {
  it('emits structured JSON lines', () => {
    const lines: string[] = [];
    const logger = createLogger({ secrets: {}, sink: (line) => lines.push(line) });
    logger.info('hello', { foo: 'bar' });
    expect(JSON.parse(lines[0])).toEqual({ level: 'info', message: 'hello', foo: 'bar' });
  });

  it('redacts known secret values from any field', () => {
    const lines: string[] = [];
    const logger = createLogger({
      secrets: { TWITTER_AUTH_TOKEN: 'super-secret' },
      sink: (line) => lines.push(line)
    });
    logger.error('boom', { detail: 'token=super-secret in error' });
    expect(lines[0]).not.toContain('super-secret');
    expect(lines[0]).toContain('[REDACTED]');
  });

  it('logs request method, path, and status without leaking secrets', () => {
    const lines: string[] = [];
    const logger = createLogger({ secrets: { TWITTER_CT0: 'ct0value' }, sink: (line) => lines.push(line) });
    const finishHandlers: Array<() => void> = [];
    const request = { method: 'GET', path: '/api/health' } as Request;
    const response = {
      statusCode: 200,
      on: (event: string, handler: () => void) => {
        if (event === 'finish') {
          finishHandlers.push(handler);
        }
      }
    } as unknown as Response;
    const next = vi.fn();

    logger.requestLogger()(request, response, next);
    expect(next).toHaveBeenCalled();
    finishHandlers.forEach((handler) => handler());

    const entry = JSON.parse(lines[0]);
    expect(entry.message).toBe('request');
    expect(entry.method).toBe('GET');
    expect(entry.path).toBe('/api/health');
    expect(entry.status).toBe(200);
  });
});
