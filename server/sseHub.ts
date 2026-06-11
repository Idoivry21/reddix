import type { RequestHandler, Response } from 'express';
import { isCrossSiteBrowserRequest } from './csrfGuard';
import type { EventLogger } from './logger';

interface SseClient {
  id: number;
  response: Response;
  idleTimer: ReturnType<typeof setTimeout> | null;
  remoteAddress: string;
}

interface SseHubOptions {
  /** Max concurrent SSE connections; further connections get 503. */
  maxClients?: number;
  /** Max concurrent SSE connections per remote address. */
  maxClientsPerRemote?: number;
  /** Heartbeat interval in ms; a comment ping keeps idle proxies from dropping the stream. */
  heartbeatMs?: number;
  /** Reconnect hint (ms) sent to the browser EventSource. */
  retryMs?: number;
  /** Maximum lifetime for a connection that never closes cleanly. */
  idleTimeoutMs?: number;
  /**
   * Sink-level redaction applied to every broadcast payload. Callers already
   * pre-redact run-step fields, but enforcing it here too means a future emit of
   * an unredacted field cannot leak a token onto the wire (defense in depth).
   */
  redact?: (value: string) => string;
  logger?: EventLogger;
}

const DEFAULT_MAX_CLIENTS = 50;
const DEFAULT_MAX_CLIENTS_PER_REMOTE = 6;
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
  const maxClientsPerRemote = options.maxClientsPerRemote ?? DEFAULT_MAX_CLIENTS_PER_REMOTE;
  const heartbeatMs = options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
  const retryMs = options.retryMs ?? DEFAULT_RETRY_MS;
  const idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
  const redact = options.redact ?? ((value: string) => value);
  const logger = options.logger;

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

  /** Write to one client, dropping it only if the socket errors. Returns success. */
  function safeWrite(client: SseClient, chunk: string): boolean {
    try {
      // response.write() returning false is normal Node backpressure, not a
      // failed socket. Keep the SSE client attached; 'error'/'close' handle death.
      client.response.write(chunk);
      return true;
    } catch {
      drop(client);
      return false;
    }
  }

  const handler: RequestHandler = (request, response) => {
    const secFetchSite = firstHeader(request.headers?.['sec-fetch-site']);
    if (isCrossSiteBrowserRequest(secFetchSite)) {
      logger?.warn('sse.crossSiteBlocked', { secFetchSite });
      response.status(403).end();
      return;
    }
    if (clients.size >= maxClients) {
      response.status(503).end();
      return;
    }
    const remoteAddress = request.ip ?? request.socket?.remoteAddress ?? 'unknown';
    if (clientsForRemote(remoteAddress) >= maxClientsPerRemote) {
      logger?.warn('sse.remoteLimited', { remoteAddress });
      response.status(503).end();
      return;
    }
    response.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
    });
    const id = clientId++;
    const client: SseClient = { id, response, idleTimer: null, remoteAddress };
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
    // Distinguish a socket-level failure from a clean close so abnormal drops
    // are observable instead of silently indistinguishable from a normal exit.
    request.on('error', (error: Error) => {
      logger?.warn('sse.socketError', { clientId: id, detail: error.message });
      drop(client);
    });
  };

  function broadcast(event: string, payload: unknown): void {
    const safePayload = redactPayload(payload, redact);
    const message = redact(`event: ${event}\ndata: ${JSON.stringify(safePayload)}\n\n`);
    for (const client of [...clients.values()]) {
      safeWrite(client, message);
    }
  }

  function clientsForRemote(remoteAddress: string): number {
    let count = 0;
    for (const client of clients.values()) {
      if (client.remoteAddress === remoteAddress) {
        count += 1;
      }
    }
    return count;
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

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function redactPayload(value: unknown, redact: (value: string) => string, seen = new WeakSet<object>()): unknown {
  if (typeof value === 'string') {
    return redact(value);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => redactPayload(entry, redact, seen));
  }
  if (typeof value !== 'object' || value === null) {
    return value;
  }
  if (seen.has(value)) {
    return '[Circular]';
  }
  seen.add(value);
  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    output[redact(key)] = redactPayload(entry, redact, seen);
  }
  seen.delete(value);
  return output;
}
