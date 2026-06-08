// @vitest-environment node

import http from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createRoutes } from '../server/routes';
import { createCsrfGuard } from '../server/csrfGuard';
import { createStorage } from '../server/storage';
import type { CliExecutor } from '../server/types';

/**
 * HTTP-contract coverage for the REST endpoints that lacked it: validation 400s,
 * the path-unsafe-id 400 guard (ensureSafeFlowId), 404s, the schedule-trigger
 * 429, and the read endpoints (/blocks, /flows). Mutating requests omit
 * Sec-Fetch-Site so the CSRF guard treats them as local tooling (allowed).
 */

let server: http.Server | null = null;
let dispose: (() => void) | null = null;

afterEach(async () => {
  if (server) {
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = null;
  }
  if (dispose) {
    dispose();
    dispose = null;
  }
});

const noopExecutor: CliExecutor = async () => ({
  stdout: JSON.stringify({ data: [] }),
  stderr: '',
  exitCode: 0
});

function validFlowBody(overrides: Record<string, unknown> = {}) {
  return {
    flow: {
      name: 'Routes Flow',
      failFast: false,
      nodes: [
        { id: 'search', type: 'reddit.searchPosts', settings: { query: 'cli', subreddit: 'localdev', sort: 'relevance', timeRange: 'month', limit: 10 } },
        { id: 'export', type: 'output.exportJson', settings: { path: 'outputs/x.json', pretty: true } }
      ],
      edges: [{ id: 'e1', source: 'search', target: 'export', sourcePortId: 'items', targetPortId: 'items' }],
      nodePositions: {},
      blockSettings: {},
      schedule: { enabled: false },
      ...overrides
    }
  };
}

async function start(): Promise<string> {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'reddix-routes-'));
  const storage = createStorage({ baseDir: dataDir });
  const { router, closeClients } = createRoutes({ storage, dataDir, executor: noopExecutor, runMinIntervalMs: 0 });
  dispose = closeClients;
  const app = express();
  app.use(createCsrfGuard());
  app.use(express.json());
  app.use('/api', router);
  return new Promise((resolve, reject) => {
    const localServer = app.listen(0, '127.0.0.1', () => {
      const address = localServer.address() as AddressInfo | null;
      if (!address) {
        reject(new Error('Test server failed to listen'));
        return;
      }
      resolve(`http://127.0.0.1:${address.port}`);
    });
    localServer.once('error', reject);
    server = localServer;
  });
}

function putFlow(base: string, id: string, body: unknown): Promise<Response> {
  return fetch(`${base}/api/flows/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

function deleteFlow(base: string, id: string): Promise<Response> {
  return fetch(`${base}/api/flows/${id}`, { method: 'DELETE' });
}

function postRuns(base: string, body: unknown): Promise<Response> {
  return fetch(`${base}/api/runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

describe('GET /api/blocks', () => {
  it('returns the block registry', async () => {
    const base = await start();
    const response = await fetch(`${base}/api/blocks`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { blocks: Array<{ type: string }> };
    expect(Array.isArray(body.blocks)).toBe(true);
    expect(body.blocks.map((b) => b.type)).toContain('reddit.searchPosts');
  });
});

describe('GET /api/flows', () => {
  it('returns an empty list for a fresh store', async () => {
    const base = await start();
    const response = await fetch(`${base}/api/flows`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ flows: [] });
  });
});

describe('GET /api/flows/:flowId', () => {
  it('returns 400 INVALID_FLOW_ID for a path-unsafe id', async () => {
    const base = await start();
    const response = await fetch(`${base}/api/flows/.hidden`);
    expect(response.status).toBe(400);
    expect((await response.json() as { code: string }).code).toBe('INVALID_FLOW_ID');
  });

  it('returns 404 for a safe but nonexistent id', async () => {
    const base = await start();
    const response = await fetch(`${base}/api/flows/nonexistent-flow`);
    expect(response.status).toBe(404);
  });

  it('returns the flow after it is saved', async () => {
    const base = await start();
    expect((await putFlow(base, 'flow-1', validFlowBody())).status).toBe(200);
    const response = await fetch(`${base}/api/flows/flow-1`);
    expect(response.status).toBe(200);
    expect((await response.json() as { flow: { id: string } }).flow.id).toBe('flow-1');
  });
});

describe('PUT /api/flows/:flowId', () => {
  it('returns 400 INVALID_FLOW_ID for a path-unsafe id', async () => {
    const base = await start();
    const response = await putFlow(base, '.hidden', validFlowBody());
    expect(response.status).toBe(400);
    expect((await response.json() as { code: string }).code).toBe('INVALID_FLOW_ID');
  });

  it('returns 400 VALIDATION_FAILED for an empty body', async () => {
    const base = await start();
    const response = await putFlow(base, 'flow-1', {});
    expect(response.status).toBe(400);
    expect((await response.json() as { code: string }).code).toBe('VALIDATION_FAILED');
  });

  it('returns 400 INVALID_FLOW_GRAPH when the graph fails validation', async () => {
    const base = await start();
    // Zod-valid body, but the required Query field is blank -> validateFlow fails.
    const response = await putFlow(base, 'flow-1', {
      flow: { name: 'Bad', nodes: [{ id: 'search', type: 'reddit.searchPosts', settings: {} }], edges: [] }
    });
    expect(response.status).toBe(400);
    expect((await response.json() as { code: string }).code).toBe('INVALID_FLOW_GRAPH');
  });
});

describe('DELETE /api/flows/:flowId', () => {
  it('returns 400 INVALID_FLOW_ID for a path-unsafe id', async () => {
    const base = await start();
    const response = await deleteFlow(base, '.hidden');
    expect(response.status).toBe(400);
    expect((await response.json() as { code: string }).code).toBe('INVALID_FLOW_ID');
  });

  it('returns 404 for a safe but nonexistent id', async () => {
    const base = await start();
    const response = await deleteFlow(base, 'nonexistent-flow');
    expect(response.status).toBe(404);
  });

  it('removes a saved flow: 204, then the flow reads back as 404', async () => {
    const base = await start();
    expect((await putFlow(base, 'flow-1', validFlowBody())).status).toBe(200);

    const deleteResponse = await deleteFlow(base, 'flow-1');
    expect(deleteResponse.status).toBe(204);

    expect((await fetch(`${base}/api/flows/flow-1`)).status).toBe(404);
    expect(await (await fetch(`${base}/api/flows`)).json()).toEqual({ flows: [] });
  });
});

describe('GET /api/runs/:flowId', () => {
  it('returns 400 for a path-unsafe id', async () => {
    const base = await start();
    const response = await fetch(`${base}/api/runs/.hidden`);
    expect(response.status).toBe(400);
    expect((await response.json() as { code: string }).code).toBe('INVALID_FLOW_ID');
  });

  it('returns an empty run history for a flow with no runs', async () => {
    const base = await start();
    const response = await fetch(`${base}/api/runs/flow-1`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ runs: [] });
  });
});

describe('POST /api/runs', () => {
  it('returns 400 VALIDATION_FAILED when flowId is missing', async () => {
    const base = await start();
    const response = await postRuns(base, {});
    expect(response.status).toBe(400);
    expect((await response.json() as { code: string }).code).toBe('VALIDATION_FAILED');
  });
});

describe('POST /api/schedules/:flowId/trigger', () => {
  it('returns 400 INVALID_FLOW_ID for a path-unsafe id', async () => {
    const base = await start();
    const response = await fetch(`${base}/api/schedules/.hidden/trigger`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    expect(response.status).toBe(400);
    expect((await response.json() as { code: string }).code).toBe('INVALID_FLOW_ID');
  });

  it('returns 404 when the flow does not exist', async () => {
    const base = await start();
    const response = await fetch(`${base}/api/schedules/nonexistent/trigger`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    expect(response.status).toBe(404);
  });

  it('returns 429 SCHEDULE_NOT_DUE with an ISO nextRunAt when triggered before the interval elapses', async () => {
    const base = await start();
    expect((await putFlow(base, 'flow-1', validFlowBody({ schedule: { enabled: true } }))).status).toBe(200);

    const response = await fetch(`${base}/api/schedules/flow-1/trigger`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    expect(response.status).toBe(429);
    const body = (await response.json()) as { code: string; details: { nextRunAt: string | null } };
    expect(body.code).toBe('SCHEDULE_NOT_DUE');
    expect(typeof body.details.nextRunAt).toBe('string');
    expect(Number.isNaN(Date.parse(body.details.nextRunAt as string))).toBe(false);
  });
});
