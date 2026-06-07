import { constants } from 'node:fs';
import { mkdir, open, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import express from 'express';
import { nanoid } from 'nanoid';
import { listBlockSpecs } from '../src/shared/commandBuilders';
import { getProviderHealthCommands } from '../src/shared/commandBuilders';
import { validateFlow } from '../src/shared/graph';
import { buildSecretMap } from '../src/shared/redaction';
import { MIN_SCHEDULE_INTERVAL_MS } from '../src/shared/schedule';
import { checkExecutable, cliExecutor } from './executor';
import { runFlow } from './runEngine';
import { createRateLimiter } from './rateLimiter';
import { createScheduler } from './scheduler';
import { formatZodError, parseFlowPutBody, parseRunPostBody } from './schemas';
import { isSafeId, resolveContainedPath } from './safeId';
import { createSseHub } from './sseHub';
import type { CliExecutor, PersistedFlow, RunRecord } from './types';

interface RoutesOptions {
  storage: ReturnType<typeof import('./storage').createStorage>;
  dataDir: string;
  /** Minimum gap between manual /runs triggers per flow (ms). */
  runMinIntervalMs?: number;
  executor?: CliExecutor;
}

export function createRoutes(options: RoutesOptions) {
  const router = express.Router();
  const sse = createSseHub();
  const executor = options.executor ?? cliExecutor;
  // Throttle the subprocess-spawning /runs route per flow to protect accounts
  // and the host from rapid repeated triggers.
  const runRateLimiter = createRateLimiter({
    minIntervalMs: Number(options.runMinIntervalMs ?? 3000)
  });

  const scheduler = createScheduler({
    minIntervalMs: MIN_SCHEDULE_INTERVAL_MS,
    jitterMs: 30 * 1000,
    runFlow: async (flowId) => {
      return runAndStore(flowId);
    },
    onSkip: async (flowId) => {
      const run = skippedRun(flowId);
      await options.storage.appendRun(run);
      sse.broadcast('run-complete', { run });
      return run;
    }
  });

  function syncSchedule(flow: PersistedFlow): void {
    if (flow.schedule?.enabled) {
      scheduler.register(flow.id, {
        intervalMs: flow.schedule.intervalMs ?? MIN_SCHEDULE_INTERVAL_MS,
        enabled: true,
        paused: flow.schedule.paused ?? false,
        providers: flowProviders(flow)
      });
    } else {
      scheduler.unregister(flow.id);
    }
  }

  // Restore persisted schedules at startup, then start the timer.
  void (async () => {
    try {
      for (const flow of await options.storage.listFlows()) {
        syncSchedule(flow);
      }
    } catch (error) {
      console.error('[reddix] failed to restore schedules:', error);
    } finally {
      scheduler.start();
    }
  })();

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

  // Read-only serve for run artifacts (HTML reports, JSON/CSV/MD exports) under
  // <dataDir>/artifacts. GET only; csrfGuard only blocks mutating verbs.
  const artifactsDir = path.join(options.dataDir, 'artifacts');
  router.get('/artifacts/*splat', async (request, response) => {
    const splat = (request.params as Record<string, unknown>).splat;
    const relPath = Array.isArray(splat) ? splat.join('/') : typeof splat === 'string' ? splat : '';
    let safePath: string;
    try {
      // Rejects `..`/absolute paths that would escape the artifacts directory.
      safePath = resolveContainedPath(artifactsDir, relPath);
    } catch {
      response.status(400).json({ error: 'Invalid artifact path' });
      return;
    }
    try {
      // resolveContainedPath only blocks lexical traversal. Re-check the REAL
      // path so a symlink planted inside the artifacts dir cannot point out of
      // it. Both sides are realpath'd so a symlinked base (e.g. macOS /var →
      // /private/var) does not produce a false rejection.
      const realBase = await realpath(artifactsDir);
      const realPath = await realpath(safePath);
      if (realPath !== realBase && !realPath.startsWith(realBase + path.sep)) {
        response.status(404).json({ error: 'Artifact not found' });
        return;
      }
      const handle = await open(realPath, constants.O_RDONLY | constants.O_NOFOLLOW);
      const contents = await handle.readFile().finally(() => handle.close());
      // Defense in depth: artifacts embed untrusted fetched content and are
      // served same-origin. nosniff stops content-type confusion; the CSP keeps
      // the report's own inline style/script working while blocking exfiltration
      // (connect/form/frame) should escaping ever regress.
      response.setHeader('X-Content-Type-Options', 'nosniff');
      response.setHeader(
        'Content-Security-Policy',
        "default-src 'none'; img-src https: data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'"
      );
      response.type(artifactContentType(realPath));
      response.send(contents);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT' || code === 'EISDIR' || code === 'ELOOP') {
        response.status(404).json({ error: 'Artifact not found' });
        return;
      }
      throw error;
    }
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
    const validation = validateFlow(flow);
    if (!validation.valid) {
      response.status(400).json({
        error: `Invalid flow graph: ${validation.errors.map((error) => `${error.nodeId}: ${error.message}`).join('; ')}`
      });
      return;
    }
    await options.storage.saveFlow(flow);
    syncSchedule(flow);
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
    if (!runRateLimiter.tryAcquire(parsed.data.flowId)) {
      response.status(429).json({ error: 'Too many runs for this flow; please wait before retrying' });
      return;
    }
    const run = (await scheduler.triggerNow(parsed.data.flowId)) as RunRecord;
    response.status(run.status === 'failed' ? 422 : 200).json({ run });
  });

  router.post('/schedules/:flowId/trigger', async (request, response) => {
    if (!isSafeId(request.params.flowId)) {
      response.status(400).json({ error: 'Invalid flow id' });
      return;
    }
    const flow = await options.storage.getFlow(request.params.flowId);
    if (!flow) {
      response.status(404).json({ error: 'Flow not found' });
      return;
    }
    if (!flow.schedule?.enabled || scheduler.getNextRunAt(flow.id) === null) {
      syncSchedule(flow);
    }
    const result = await scheduler.triggerDue(request.params.flowId);
    if (!result.triggered) {
      response.status(429).json({
        error: 'Schedule is not due yet',
        nextRunAt: result.nextRunAt ? new Date(result.nextRunAt).toISOString() : null
      });
      return;
    }
    const run = result.result as RunRecord;
    response.status(run.status === 'failed' ? 422 : 200).json({ run });
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
      executor,
      secrets: buildSecretMap(process.env),
      writeArtifact: writeArtifact(options.dataDir),
      emit: (event) => sse.broadcast('run-step', event)
    });
    await options.storage.appendRun(run);
    sse.broadcast('run-complete', { run });
    return run;
  }

  function dispose(): void {
    scheduler.stop();
    sse.closeAll();
  }

  return { router, eventsHandler: sse.handler, closeClients: dispose };
}

/** Unique CLI providers a flow touches, derived from its node types. */
function flowProviders(flow: PersistedFlow): string[] {
  const providers = new Set<string>();
  for (const node of flow.nodes) {
    if (node.type.startsWith('reddit.')) {
      providers.add('reddit');
    } else if (node.type.startsWith('twitter.')) {
      providers.add('twitter');
    }
  }
  return [...providers];
}

/** Map an artifact's extension to a response content type; default text/plain. */
function artifactContentType(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case '.html':
      return 'text/html; charset=utf-8';
    case '.json':
      return 'application/json; charset=utf-8';
    case '.csv':
      return 'text/csv; charset=utf-8';
    case '.md':
      return 'text/markdown; charset=utf-8';
    default:
      return 'text/plain; charset=utf-8';
  }
}

function writeArtifact(dataDir: string) {
  const artifactsDir = path.join(dataDir, 'artifacts');
  return async (filePath: string, contents: string): Promise<{ path: string; bytes: number }> => {
    const safePath = resolveContainedPath(artifactsDir, filePath);
    await mkdir(path.dirname(safePath), { recursive: true });
    await writeFile(safePath, contents);
    return { path: filePath, bytes: Buffer.byteLength(contents) };
  };
}

function failedRun(flowId: string, error: string): RunRecord {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    id: `failed-${nanoid()}`,
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
    id: `skipped-${nanoid()}`,
    flowId,
    status: 'skipped',
    startedAt: now,
    endedAt: now,
    steps: [],
    outputFiles: [],
    error: 'Skipped because a previous run is still in flight'
  };
}
