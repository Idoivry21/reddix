import type { RequestHandler, Response } from 'express';

interface SseClient {
  id: number;
  response: Response;
  idleTimer: ReturnType<typeof setTimeout> | null;
}

interface SseHubOptions {
  /** Max concurrent SSE connections; further connections get 503. */
  maxClients?: number;
  /** Heartbeat interval in ms; a comment ping keeps idle proxies from dropping the stream. */
  heartbeatMs?: number;
  /** Reconnect hint (ms) sent to the browser EventSource. */
  retryMs?: number;
  /** Maximum lifetime for a connection that never closes cleanly. */
  idleTimeoutMs?: number;
}

const DEFAULT_MAX_CLIENTS = 50;
const DEFAULT_HEARTBEAT_MS = 25_000;
const DEFAULT_RETRY_MS = 3_000;
const DEFAULT_IDLE_TIMEOUT_MS = 5 * 60_000;

export interface SseHub {
  handler: RequestHandler;
  broadcast: (event: string, payload: unknown) => void;
  pingAll: () => void;
  closeAll: () => void;
  readonly clientCount: number;
}

/**
 * Server-Sent-Events fan-out hub. Every write is guarded so a dead or slow
 * client can never throw into the run loop; failed clients are dropped. A
 * periodic heartbeat keeps the stream alive through idle proxies, and a
 * connection cap bounds resource use.
 */
export function createSseHub(options: SseHubOptions = {}): SseHub {
  const maxClients = options.maxClients ?? DEFAULT_MAX_CLIENTS;
  const heartbeatMs = options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
  const retryMs = options.retryMs ?? DEFAULT_RETRY_MS;
  const idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;

  const clients = new Map<number, SseClient>();
  let clientId = 0;

  function drop(client: SseClient): void {
    clients.delete(client.id);
    if (client.idleTimer) {
      clearTimeout(client.idleTimer);
      client.idleTimer = null;
    }
    try {
      client.response.end();
    } catch {
      // Already closed; nothing to do.
    }
  }

  /** Write to one client, dropping it if the socket is gone. Returns success. */
  function safeWrite(client: SseClient, chunk: string): boolean {
    try {
      const writable = client.response.write(chunk);
      if (!writable) {
        drop(client);
        return false;
      }
      return true;
    } catch {
      drop(client);
      return false;
    }
  }

  const handler: RequestHandler = (request, response) => {
    if (clients.size >= maxClients) {
      response.status(503).end();
      return;
    }
    response.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
    });
    const id = clientId++;
    const client: SseClient = { id, response, idleTimer: null };
    client.idleTimer = setTimeout(() => {
      drop(client);
    }, idleTimeoutMs);
    if (typeof client.idleTimer.unref === 'function') {
      client.idleTimer.unref();
    }
    clients.set(id, client);
    safeWrite(client, `retry: ${retryMs}\n\nevent: ready\ndata: {}\n\n`);
    request.on('close', () => {
      drop(client);
    });
  };

  function broadcast(event: string, payload: unknown): void {
    const message = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
    for (const client of [...clients.values()]) {
      safeWrite(client, message);
    }
  }

  function pingAll(): void {
    for (const client of [...clients.values()]) {
      safeWrite(client, ': ping\n\n');
    }
  }

  const heartbeat = setInterval(pingAll, heartbeatMs);
  // Do not keep the process alive solely for the heartbeat.
  if (typeof heartbeat.unref === 'function') {
    heartbeat.unref();
  }

  function closeAll(): void {
    clearInterval(heartbeat);
    for (const client of [...clients.values()]) {
      drop(client);
    }
    clients.clear();
  }

  return {
    handler,
    broadcast,
    pingAll,
    closeAll,
    get clientCount() {
      return clients.size;
    }
  };
}
