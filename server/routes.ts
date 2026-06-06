import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import express from 'express';
import { listBlockSpecs } from '../src/shared/commandBuilders';
import { getProviderHealthCommands } from '../src/shared/commandBuilders';
import { buildSecretMap } from '../src/shared/redaction';
import { checkExecutable, cliExecutor } from './executor';
import { runFlow } from './runEngine';
import { createScheduler } from './scheduler';
import { formatZodError, parseFlowPutBody, parseRunPostBody } from './schemas';
import { isSafeId } from './safeId';
import type { PersistedFlow, RunRecord } from './types';

interface RoutesOptions {
  storage: ReturnType<typeof import('./storage').createStorage>;
  dataDir: string;
}

interface SseClient {
  id: number;
  response: express.Response;
}

export function createRoutes(options: RoutesOptions) {
  const router = express.Router();
  const clients = new Map<number, SseClient>();
  let clientId = 0;

  const scheduler = createScheduler({
    minIntervalMs: 15 * 60 * 1000,
    jitterMs: 30 * 1000,
    runFlow: async (flowId) => {
      await runAndStore(flowId);
    },
    onSkip: async (flowId) => {
      await options.storage.appendRun(skippedRun(flowId));
    }
  });

  router.get('/health', async (_request, response) => {
    const providers = await Promise.all(
      getProviderHealthCommands().map(async (command) => ({
        provider: command.provider,
        executable: command.executable,
        available: await checkExecutable(command.executable)
      }))
    );
    response.json({ ok: true, app: 'Reddix', providers });
  });

  router.get('/blocks', (_request, response) => {
    response.json({ blocks: listBlockSpecs() });
  });

  router.get('/flows', async (_request, response) => {
    response.json({ flows: await options.storage.listFlows() });
  });

  router.get('/flows/:flowId', async (request, response) => {
    if (!isSafeId(request.params.flowId)) {
      response.status(400).json({ error: 'Invalid flow id' });
      return;
    }
    const flow = await options.storage.getFlow(request.params.flowId);
    if (!flow) {
      response.status(404).json({ error: 'Flow not found' });
      return;
    }
    response.json({ flow });
  });

  router.put('/flows/:flowId', async (request, response) => {
    if (!isSafeId(request.params.flowId)) {
      response.status(400).json({ error: 'Invalid flow id' });
      return;
    }
    const parsed = parseFlowPutBody(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: `Invalid flow body: ${formatZodError(parsed.error)}` });
      return;
    }
    const incoming = parsed.data.flow;
    const now = new Date().toISOString();
    const flow: PersistedFlow = {
      schemaVersion: 1,
      id: request.params.flowId,
      name: incoming.name ?? 'Untitled Flow',
      failFast: incoming.failFast ?? false,
      nodes: incoming.nodes,
      edges: incoming.edges,
      nodePositions: incoming.nodePositions,
      blockSettings: incoming.blockSettings,
      schedule: incoming.schedule,
      createdAt: incoming.createdAt ?? now,
      updatedAt: now
    };
    await options.storage.saveFlow(flow);
    response.json({ flow });
  });

  router.get('/runs/:flowId', async (request, response) => {
    if (!isSafeId(request.params.flowId)) {
      response.status(400).json({ error: 'Invalid flow id' });
      return;
    }
    response.json({ runs: await options.storage.listRuns(request.params.flowId) });
  });

  router.post('/runs', async (request, response) => {
    const parsed = parseRunPostBody(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: `Invalid run request: ${formatZodError(parsed.error)}` });
      return;
    }
    const run = await runAndStore(parsed.data.flowId);
    response.status(run.status === 'failed' ? 422 : 200).json({ run });
  });

  router.post('/schedules/:flowId/trigger', async (request, response) => {
    if (!isSafeId(request.params.flowId)) {
      response.status(400).json({ error: 'Invalid flow id' });
      return;
    }
    await scheduler.triggerNow(request.params.flowId);
    response.json({ ok: true });
  });

  router.get('/events', (request, response) => {
    response.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
    });
    response.write('event: ready\ndata: {}\n\n');
    const id = clientId++;
    clients.set(id, { id, response });
    request.on('close', () => {
      clients.delete(id);
    });
  });

  async function runAndStore(flowId: string): Promise<RunRecord> {
    const flow = await options.storage.getFlow(flowId);
    if (!flow) {
      const run = failedRun(flowId, 'Flow not found');
      await options.storage.appendRun(run);
      return run;
    }
    const run = await runFlow({
      flow,
      executor: cliExecutor,
      secrets: buildSecretMap(process.env),
      writeArtifact: writeArtifact(options.dataDir),
      emit: (event) => broadcast('run-step', event)
    });
    await options.storage.appendRun(run);
    broadcast('run-complete', { run });
    return run;
  }

  function broadcast(event: string, payload: unknown) {
    const message = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
    for (const client of clients.values()) {
      client.response.write(message);
    }
  }

  function closeClients() {
    for (const client of clients.values()) {
      client.response.end();
    }
    clients.clear();
  }

  return { router, closeClients };
}

function writeArtifact(dataDir: string) {
  return async (filePath: string, contents: string): Promise<{ path: string; bytes: number }> => {
    const safePath = path.join(dataDir, 'artifacts', filePath);
    await mkdir(path.dirname(safePath), { recursive: true });
    await writeFile(safePath, contents);
    return { path: filePath, bytes: Buffer.byteLength(contents) };
  };
}

function failedRun(flowId: string, error: string): RunRecord {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    id: `failed-${Date.now()}`,
    flowId,
    status: 'failed',
    startedAt: now,
    endedAt: now,
    steps: [],
    outputFiles: [],
    error
  };
}

function skippedRun(flowId: string): RunRecord {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    id: `skipped-${Date.now()}`,
    flowId,
    status: 'skipped',
    startedAt: now,
    endedAt: now,
    steps: [],
    outputFiles: [],
    error: 'Skipped because a previous run is still in flight'
  };
}

