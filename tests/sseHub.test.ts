import { describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import { createSseHub } from '../server/sseHub';

interface FakeResponse {
  response: Response;
  writes: string[];
  headers: Record<string, unknown> | null;
  status: number;
  ended: boolean;
  failOnWriteAfter: number | null;
  writeResult: boolean;
}

function fakeResponse(failOnWriteAfter: number | null = null, writeResult = true): FakeResponse {
  const state: FakeResponse = {
    writes: [],
    headers: null,
    status: 200,
    ended: false,
    failOnWriteAfter,
    writeResult,
    response: undefined as unknown as Response
  };
  const handlers: Record<string, () => void> = {};
  state.response = {
    writeHead(code: number, headers: Record<string, unknown>) {
      state.status = code;
      state.headers = headers;
      return this;
    },
    write(chunk: string) {
      if (state.failOnWriteAfter !== null && state.writes.length >= state.failOnWriteAfter) {
        throw new Error('client gone');
      }
      state.writes.push(chunk);
      return state.writeResult;
    },
    status(code: number) {
      state.status = code;
      return this;
    },
    end() {
      state.ended = true;
      return this;
    }
  } as unknown as Response;
  // request.on('close') stub attached via connect()
  (state.response as unknown as { _handlers: typeof handlers })._handlers = handlers;
  return state;
}

function fakeRequest(overrides: Partial<Request> = {}): Request {
  const handlers: Record<string, () => void> = {};
  return {
    headers: {},
    ip: '127.0.0.1',
    on(event: string, handler: () => void) {
      handlers[event] = handler;
      return this;
    },
    _emit(event: string) {
      handlers[event]?.();
    },
    ...overrides
  } as unknown as Request;
}

describe('createSseHub', () => {
  it('sends a reconnect hint and ready event on connect', () => {
    const hub = createSseHub();
    const res = fakeResponse();
    hub.handler(fakeRequest(), res.response, vi.fn());

    expect(res.status).toBe(200);
    expect(res.headers?.['Content-Type']).toBe('text/event-stream');
    expect(res.writes.join('')).toContain('retry:');
    expect(res.writes.join('')).toContain('event: ready');
    expect(hub.clientCount).toBe(1);
  });

  it('drops a client whose write throws during broadcast', () => {
    const hub = createSseHub();
    const good = fakeResponse();
    const bad = fakeResponse();
    hub.handler(fakeRequest(), good.response, vi.fn());
    hub.handler(fakeRequest(), bad.response, vi.fn());
    expect(hub.clientCount).toBe(2);
    // Arm failure after the handshake so the next write (broadcast) throws,
    // independent of how many chunks the handshake emits.
    bad.failOnWriteAfter = bad.writes.length;

    hub.broadcast('run-step', { ok: true });

    expect(hub.clientCount).toBe(1);
    expect(bad.ended).toBe(true);
    expect(good.writes.join('')).toContain('run-step');
  });

  it('drops a client when response.write signals backpressure', () => {
    const hub = createSseHub();
    const slow = fakeResponse(null, false);

    hub.handler(fakeRequest(), slow.response, vi.fn());

    expect(hub.clientCount).toBe(0);
    expect(slow.ended).toBe(true);
  });

  it('drops idle clients that never close cleanly', () => {
    vi.useFakeTimers();
    try {
      const hub = createSseHub({ heartbeatMs: 100, idleTimeoutMs: 250 });
      const res = fakeResponse();
      hub.handler(fakeRequest(), res.response, vi.fn());
      expect(hub.clientCount).toBe(1);

      vi.advanceTimersByTime(251);

      expect(hub.clientCount).toBe(0);
      expect(res.ended).toBe(true);
      hub.closeAll();
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects connections beyond the max client cap', () => {
    const hub = createSseHub({ maxClients: 1 });
    const first = fakeResponse();
    const second = fakeResponse();
    hub.handler(fakeRequest(), first.response, vi.fn());
    hub.handler(fakeRequest(), second.response, vi.fn());

    expect(hub.clientCount).toBe(1);
    expect(second.status).toBe(503);
    expect(second.ended).toBe(true);
  });

  it('rejects browser cross-site SSE connections', () => {
    const hub = createSseHub();
    const res = fakeResponse();

    hub.handler(fakeRequest({ headers: { 'sec-fetch-site': 'cross-site' } } as Partial<Request>), res.response, vi.fn());

    expect(res.status).toBe(403);
    expect(res.ended).toBe(true);
    expect(hub.clientCount).toBe(0);
  });

  it('caps SSE connections per remote address', () => {
    const hub = createSseHub({ maxClientsPerRemote: 1 });
    const first = fakeResponse();
    const second = fakeResponse();

    hub.handler(fakeRequest({ ip: '203.0.113.10' } as Partial<Request>), first.response, vi.fn());
    hub.handler(fakeRequest({ ip: '203.0.113.10' } as Partial<Request>), second.response, vi.fn());

    expect(hub.clientCount).toBe(1);
    expect(second.status).toBe(503);
    expect(second.ended).toBe(true);
  });

  it('removes a client when its request closes', () => {
    const hub = createSseHub();
    const res = fakeResponse();
    const req = fakeRequest();
    hub.handler(req, res.response, vi.fn());
    expect(hub.clientCount).toBe(1);

    (req as unknown as { _emit: (e: string) => void })._emit('close');
    expect(hub.clientCount).toBe(0);
  });

  it('pings all clients and drops dead ones', () => {
    const hub = createSseHub();
    const alive = fakeResponse();
    const dead = fakeResponse();
    hub.handler(fakeRequest(), alive.response, vi.fn());
    hub.handler(fakeRequest(), dead.response, vi.fn());
    dead.failOnWriteAfter = dead.writes.length; // dies on the next write (ping)

    hub.pingAll();

    expect(alive.writes.join('')).toContain(':'); // comment ping
    expect(hub.clientCount).toBe(1);
  });

  it('closeAll ends every client and clears the heartbeat', () => {
    const hub = createSseHub();
    const res = fakeResponse();
    hub.handler(fakeRequest(), res.response, vi.fn());
    hub.closeAll();
    expect(res.ended).toBe(true);
    expect(hub.clientCount).toBe(0);
  });
});
