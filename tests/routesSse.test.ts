import type { Request, RequestHandler, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { createRoutes } from '../server/routes';
import { createStorage } from '../server/storage';

describe('SSE route mounting', () => {
  it('exposes a root /events handler for the Vite proxy', () => {
    const dataDir = '/tmp/reddix-sse-test';
    const storage = createStorage({ baseDir: dataDir });
    const routes = createRoutes({ storage, dataDir }) as ReturnType<typeof createRoutes> & {
      eventsHandler?: RequestHandler;
    };
    const request = { on: vi.fn() } as unknown as Request;
    const response = mockSseResponse();

    try {
      expect(routes.eventsHandler).toBeTypeOf('function');
      routes.eventsHandler!(request, response, vi.fn());

      expect(response.writeHead).toHaveBeenCalledWith(
        200,
        expect.objectContaining({ 'Content-Type': 'text/event-stream' })
      );
      const written = (response.write as ReturnType<typeof vi.fn>).mock.calls
        .map((call) => String(call[0]))
        .join('');
      expect(written).toContain('event: ready');
      // T201: a reconnect hint is sent so the browser EventSource auto-reconnects.
      expect(written).toContain('retry:');
    } finally {
      routes.closeClients();
    }
  });
});

function mockSseResponse(): Response {
  return {
    writeHead: vi.fn(),
    write: vi.fn(),
    end: vi.fn()
  } as unknown as Response;
}
