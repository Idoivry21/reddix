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

const redditExecutor: CliExecutor = async () => ({
  stdout: JSON.stringify({ data: [{ id: 'a', title: 'CLI automation', created_utc: 1716500000, score: 8 }] }),
  stderr: '',
  exitCode: 0
});

const FLOW_BODY = {
  flow: {
    name: 'Node Run Flow',
    failFast: false,
    nodes: [
      {
        id: 'search',
        type: 'reddit.searchPosts',
        settings: { query: 'cli', subreddit: 'localdev', sort: 'relevance', timeRange: 'month', limit: 10 }
      },
      { id: 'export', type: 'output.exportJson', settings: { path: 'outputs/x.json', pretty: true } }
    ],
    edges: [{ id: 'e1', source: 'search', target: 'export', sourcePortId: 'items', targetPortId: 'items' }],
    nodePositions: {},
    blockSettings: {},
    schedule: { enabled: false }
  }
};

async function start(executor: CliExecutor, runMinIntervalMs = 0): Promise<string> {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'reddix-node-run-'));
  const storage = createStorage({ baseDir: dataDir });
  const { router, closeClients } = createRoutes({ storage, dataDir, executor, runMinIntervalMs });
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

function postJson(base: string, body: unknown): Promise<Response> {
  return fetch(`${base}/api/runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

async function putFlow(base: string): Promise<void> {
  const response = await fetch(`${base}/api/flows/flow-1`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(FLOW_BODY)
  });
  if (response.status !== 200) {
    throw new Error(`Flow PUT failed: ${response.status} ${await response.text()}`);
  }
}

describe('POST /api/runs (single node)', () => {
  it('runs one node in static mode and does not persist it to run history', async () => {
    const base = await start(redditExecutor);
    await putFlow(base);

    const response = await postJson(base, { flowId: 'flow-1', nodeId: 'search', mode: 'static' });
    expect(response.status).toBe(200);
    const { run } = (await response.json()) as { run: { steps: unknown[]; trigger?: unknown } };
    expect(run.steps).toHaveLength(1);
    expect(run.trigger).toMatchObject({ kind: 'single-node', nodeId: 'search', mode: 'static' });

    // Ephemeral: the node run is never written to the flow's history.
    const history = (await (await fetch(`${base}/api/runs/flow-1`)).json()) as { runs: unknown[] };
    expect(history.runs).toEqual([]);
  });

  it('rejects a single-node body that is missing the mode', async () => {
    const base = await start(redditExecutor);
    await putFlow(base);
    const response = await postJson(base, { flowId: 'flow-1', nodeId: 'search' });
    expect(response.status).toBe(400);
  });

  it('rate-limits per node in a separate bucket from full-flow runs', async () => {
    const base = await start(redditExecutor, 60_000);
    await putFlow(base);

    expect((await postJson(base, { flowId: 'flow-1', nodeId: 'search', mode: 'static' })).status).toBe(200);
    // Same node bucket is now throttled.
    expect((await postJson(base, { flowId: 'flow-1', nodeId: 'search', mode: 'static' })).status).toBe(429);
    // A full-flow run uses a different bucket and is still allowed.
    expect((await postJson(base, { flowId: 'flow-1' })).status).toBe(200);
  });

  it('rejects a cross-site single-node run with 403', async () => {
    const base = await start(redditExecutor);
    await putFlow(base);
    const response = await fetch(`${base}/api/runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'cross-site' },
      body: JSON.stringify({ flowId: 'flow-1', nodeId: 'search', mode: 'static' })
    });
    expect(response.status).toBe(403);
  });
});
