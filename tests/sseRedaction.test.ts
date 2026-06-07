import { describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import { createSseHub } from '../server/sseHub';

function fakeResponse(): { response: Response; writes: string[] } {
  const writes: string[] = [];
  const response = {
    writeHead() {
      return this;
    },
    write(chunk: string) {
      writes.push(chunk);
      return true;
    },
    end() {
      return this;
    }
  } as unknown as Response;
  return { response, writes };
}

function fakeRequest(): Request & { _emit: (event: string, arg?: unknown) => void } {
  const handlers: Record<string, (arg?: unknown) => void> = {};
  return {
    on(event: string, handler: (arg?: unknown) => void) {
      handlers[event] = handler;
      return this;
    },
    _emit(event: string, arg?: unknown) {
      handlers[event]?.(arg);
    }
  } as unknown as Request & { _emit: (event: string, arg?: unknown) => void };
}

describe('SSE sink redaction (finding 13)', () => {
  it('scrubs a secret from a broadcast payload at the sink', () => {
    const secret = 'super-secret-token';
    const hub = createSseHub({ redact: (value) => value.split(secret).join('[REDACTED]') });
    const client = fakeResponse();
    hub.handler(fakeRequest(), client.response, vi.fn());

    hub.broadcast('run-step', { leak: `value ${secret} here` });

    const sent = client.writes.join('');
    expect(sent).not.toContain(secret);
    expect(sent).toContain('[REDACTED]');
  });

  it('logs a socket error distinctly from a clean close (finding 21)', () => {
    const lines: Array<{ message: string }> = [];
    const logger = {
      info: () => {},
      warn: (message: string) => lines.push({ message }),
      error: () => {}
    };
    const hub = createSseHub({ logger });
    const request = fakeRequest();
    hub.handler(request, fakeResponse().response, vi.fn());

    request._emit('error', new Error('ECONNRESET'));

    expect(lines.some((line) => line.message === 'sse.socketError')).toBe(true);
    expect(hub.clientCount).toBe(0);
  });
});
