import { constants } from 'node:fs';
import { access, mkdir, open, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import express from 'express';
import type { Request, Response } from 'express';
import { getProviderHealthCommands, listBlockSpecs } from '../src/shared/commandBuilders';
import { validateFlow } from '../src/shared/graph';
import { buildSecretMap, redactSecrets } from '../src/shared/redaction';
import { MIN_SCHEDULE_INTERVAL_MS } from '../src/shared/schedule';
import { CLI_PROVIDERS } from '../src/shared/providers';
import { checkExecutable, createCliExecutor } from './executor';
import type { EventLogger } from './logger';
import { noopMetrics, type Metrics } from './metrics';
import { runFlow } from './runEngine';
import { createRateLimiter } from './rateLimiter';
import { createScheduler } from './scheduler';
import { formatZodError, parseFlowPutBody, parseRunPostBody } from './schemas';
import { isSafeId, resolveContainedPath } from './safeId';
import { makeTerminalRun } from './runRecord';
import { createSseHub } from './sseHub';
import type { CliExecutor, PersistedFlow, RunRecord } from './types';

/** Subdirectory of the data dir where run artifacts are written AND served from.
 * Single-sourced so the write path and the GET /artifacts read path can't drift. */
const ARTIFACTS_SUBDIR = 'artifacts';
/** Default minimum gap between manual /runs triggers per flow (ms). */
const DEFAULT_RUN_MIN_INTERVAL_MS = 3000;

function artifactsDirFor(dataDir: string): string {
  return path.join(dataDir, ARTIFACTS_SUBDIR);
}

/** 400-guard for `:flowId` routes — rejects path-unsafe ids in one place. Returns
 * false (and has already sent the 400) when the caller should stop. */
function ensureSafeFlowId(request: Request, response: Response): boolean {
  if (!isSafeId(request.params.flowId)) {
    response.status(400).json({ error: 'Invalid flow id', code: 'INVALID_FLOW_ID' });
    return false;
  }
  return true;
}

/** Public run-result response: a failed run is a 422, anything else 200. */
function respondWithRun(response: Response, run: RunRecord): void {
  response.status(run.status === 'failed' ? 422 : 200).json({ run });
}

interface RoutesOptions {
  storage: ReturnType<typeof import('./storage').createStorage>;
  dataDir: string;
  /** Minimum gap between manual /runs triggers per flow (ms). */
  runMinIntervalMs?: number;
  executor?: CliExecutor;
  logger?: EventLogger;
  metrics?: Metrics;
}

export function createRoutes(options: RoutesOptions) {
  const router = express.Router();
  const logger = options.logger;
  const metrics = options.metrics ?? noopMetrics;
  const secrets = buildSecretMap(process.env);
  const sse = createSseHub({ logger, redact: (value) => redactSecrets(value, secrets) });
  const executor = options.executor ?? createCliExecutor({ logger, metrics });
  // Throttle the subprocess-spawning /runs route per flow to protect accounts
  // and the host from rapid repeated triggers.
  const runRateLimiter = createRateLimiter({
    minIntervalMs: Number(options.runMinIntervalMs ?? DEFAULT_RUN_MIN_INTERVAL_MS)
  });

  const scheduler = createScheduler({
    minIntervalMs: MIN_SCHEDULE_INTERVAL_MS,
    jitterMs: 30 * 1000,
    logger,
    metrics,
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
    let attempted = 0;
    let synced = 0;
    try {
      const flows = await options.storage.listFlows();
      attempted = flows.length;
      for (const flow of flows) {
        syncSchedule(flow);
        if (flow.schedule?.enabled) {
          synced += 1;
        }
      }
      logger?.info('schedules.restored', { attempted, synced });
    } catch (error) {
      // Recovery failed: the scheduler will start with zero flows. Surface this
      // as a structured, degraded-startup signal — not a bare console line.
      logger?.error('schedules.restoreFailed', {
        attempted,
        synced,
        detail: error instanceof Error ? error.message : String(error)
      });
    } finally {
      scheduler.start();
      logger?.info('scheduler.started', {});
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
    // `ok` reflects SERVER health — can the app persist runs? Missing CLI
    // binaries are a normal, separately-reported state (the app's job is to
    // detect and report them), not a server outage, so they do not flip `ok`.
    const storageWritable = await isDataDirWritable(options.dataDir);
    const ok = storageWritable;
    if (!ok) {
      logger?.error('health.degraded', { storageWritable });
    }
    response
      .status(ok ? 200 : 503)
      .json({ ok, app: 'Reddix', providers, storage: { writable: storageWritable }, sseClients: sse.clientCount });
  });

  router.get('/metrics', (_request, response) => {
    response.json(metrics.snapshot());
  });

  router.get('/blocks', (_request, response) => {
    response.json({ blocks: listBlockSpecs() });
  });

  // Read-only serve for run artifacts (HTML reports, JSON/CSV/MD exports) under
  // <dataDir>/artifacts. GET only; csrfGuard only blocks mutating verbs.
  const artifactsDir = artifactsDirFor(options.dataDir);
  router.get('/artifacts/*splat', async (request, response) => {
    const splat = (request.params as Record<string, unknown>).splat;
    const relPath = Array.isArray(splat) ? splat.join('/') : typeof splat === 'string' ? splat : '';
    let safePath: string;
    try {
      // Rejects `..`/absolute paths that would escape the artifacts directory.
      safePath = resolveContainedPath(artifactsDir, relPath);
    } catch {
      // Log the rejected relative path so traversal attempts are auditable.
      logger?.warn('artifact.invalidPath', { relPath });
      response.status(400).json({ error: 'Invalid artifact path', code: 'INVALID_ARTIFACT_PATH' });
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
      // Unexpected fs error (EACCES, EMFILE, …): log with the requested path and
      // error code before re-throwing, so the resulting 500 is not anonymous.
      logger?.error('artifact.readFailed', { relPath, code: code ?? 'unknown' });
      throw error;
    }
  });

  router.get('/flows', async (_request, response) => {
    response.json({ flows: await options.storage.listFlows() });
  });

  router.get('/flows/:flowId', async (request, response) => {
    if (!ensureSafeFlowId(request, response)) {
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
    if (!ensureSafeFlowId(request, response)) {
      return;
    }
    const parsed = parseFlowPutBody(request.body);
    if (!parsed.success) {
      response.status(400).json({
        error: `Invalid flow body: ${formatZodError(parsed.error)}`,
        code: 'VALIDATION_FAILED'
      });
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
        error: `Invalid flow graph: ${validation.errors.map((error) => `${error.nodeId}: ${error.message}`).join('; ')}`,
        code: 'INVALID_FLOW_GRAPH'
      });
      return;
    }
    await options.storage.saveFlow(flow);
    syncSchedule(flow);
    response.json({ flow });
  });

  router.get('/runs/:flowId', async (request, response) => {
    if (!ensureSafeFlowId(request, response)) {
      return;
    }
    response.json({ runs: await options.storage.listRuns(request.params.flowId) });
  });

  router.post('/runs', async (request, response) => {
    const parsed = parseRunPostBody(request.body);
    if (!parsed.success) {
      response.status(400).json({
        error: `Invalid run request: ${formatZodError(parsed.error)}`,
        code: 'VALIDATION_FAILED'
      });
      return;
    }
    if (!runRateLimiter.tryAcquire(parsed.data.flowId)) {
      metrics.increment('run_rate_limited_total');
      logger?.warn('run.rateLimited', { flowId: parsed.data.flowId });
      response.status(429).json({
        error: 'Too many runs for this flow; please wait before retrying',
        code: 'RATE_LIMITED'
      });
      return;
    }
    const run = (await scheduler.triggerNow(parsed.data.flowId)) as RunRecord;
    respondWithRun(response, run);
  });

  router.post('/schedules/:flowId/trigger', async (request, response) => {
    if (!ensureSafeFlowId(request, response)) {
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
        code: 'SCHEDULE_NOT_DUE',
        details: { nextRunAt: result.nextRunAt ? new Date(result.nextRunAt).toISOString() : null }
      });
      return;
    }
    const run = result.result as RunRecord;
    respondWithRun(response, run);
  });

  // A storage failure here propagates to the caller on purpose. The two callers
  // both handle it safely and honestly: the scheduler tick wraps triggerDue in
  // try/catch (so a persist error is logged, never an unhandled rejection that
  // crashes the process), and the manual POST /runs path surfaces it as a 500
  // so the client is not told a run was saved when it was not.
  async function runAndStore(flowId: string): Promise<RunRecord> {
    const flow = await options.storage.getFlow(flowId);
    if (!flow) {
      logger?.warn('run.flowNotFound', { flowId });
      metrics.increment('flow_runs_total', { status: 'failed' });
      const run = failedRun(flowId, 'Flow not found');
      await options.storage.appendRun(run);
      return run;
    }
    const run = await runFlow({
      flow,
      executor,
      secrets,
      writeArtifact: writeArtifact(options.dataDir),
      emit: (event) => sse.broadcast('run-step', event),
      logger,
      metrics
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

/**
 * Probe whether the data directory can be written. Used by /health so a broken
 * data dir (the thing that actually fails runs) is reported, not masked behind
 * a hardcoded ok:true.
 */
async function isDataDirWritable(dataDir: string): Promise<boolean> {
  try {
    await mkdir(dataDir, { recursive: true });
    await access(dataDir, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/** Unique CLI providers a flow touches, derived from its node types. */
function flowProviders(flow: PersistedFlow): string[] {
  const providers = new Set<string>();
  for (const node of flow.nodes) {
    for (const meta of CLI_PROVIDERS) {
      if (node.type.startsWith(meta.nodePrefix)) {
        providers.add(meta.id);
      }
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
  const artifactsDir = artifactsDirFor(dataDir);
  return async (filePath: string, contents: string): Promise<{ path: string; bytes: number }> => {
    const safePath = resolveContainedPath(artifactsDir, filePath);
    await mkdir(path.dirname(safePath), { recursive: true });
    await writeFile(safePath, contents);
    return { path: filePath, bytes: Buffer.byteLength(contents) };
  };
}

function failedRun(flowId: string, error: string): RunRecord {
  return makeTerminalRun({ flowId, status: 'failed', error });
}

function skippedRun(flowId: string): RunRecord {
  return makeTerminalRun({
    flowId,
    status: 'skipped',
    error: 'Skipped because a previous run is still in flight'
  });
}
