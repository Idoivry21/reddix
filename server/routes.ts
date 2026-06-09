import { constants } from 'node:fs';
import { access, lstat, mkdir, open, realpath } from 'node:fs/promises';
import path from 'node:path';
import express from 'express';
import type { Request, Response } from 'express';
import { getProviderHealthCommands, listBlockSpecs } from '../src/shared/commandBuilders';
import { validateFlow } from '../src/shared/graph';
import { buildSecretMap, collectWebhookSecrets, redactSecrets } from '../src/shared/redaction';
import { MAX_SCHEDULE_INTERVAL_MS, MIN_SCHEDULE_INTERVAL_MS } from '../src/shared/schedule';
import { CLI_PROVIDERS } from '../src/shared/providers';
import { checkExecutable, createCliExecutor } from './executor';
import type { EventLogger } from './logger';
import { noopMetrics, type Metrics } from './metrics';
import { runFlow, runSingleNode } from './runEngine';
import { createRateLimiter } from './rateLimiter';
import { createScheduler } from './scheduler';
import { formatZodError, parseFlowPutBody, parseRunPostBody } from './schemas';
import { isSafeId, resolveContainedPath } from './safeId';
import { makeTerminalRun } from './runRecord';
import { createSseHub } from './sseHub';
import type { CliExecutor, PersistedFlow, RunRecord } from './types';
import type { SingleNodeMode } from '../src/shared/types';

/** Subdirectory of the data dir where run artifacts are written AND served from.
 * Single-sourced so the write path and the GET /artifacts read path can't drift. */
const ARTIFACTS_SUBDIR = 'artifacts';
/** Default minimum gap between manual /runs triggers per flow (ms). */
const DEFAULT_RUN_MIN_INTERVAL_MS = 3000;
/** Short health cache: enough to absorb drive-by bursts without hiding long-lived degradation. */
const DEFAULT_HEALTH_CACHE_TTL_MS = 15_000;
const DEFAULT_HEALTH_MIN_INTERVAL_MS = 1_000;
const MAX_ARTIFACT_REL_PATH_LENGTH = 2048;
const MAX_ARTIFACT_SEGMENT_LENGTH = 255;
const MAX_ARTIFACT_BYTES = 10 * 1024 * 1024;

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
  providerHealthChecker?: (executable: 'rdt' | 'twitter') => Promise<boolean>;
  healthCacheTtlMs?: number;
  healthMinIntervalMs?: number;
  logger?: EventLogger;
  metrics?: Metrics;
}

interface HealthSnapshot {
  statusCode: number;
  // Only non-volatile probe results are cached here. The live SSE client count is
  // overlaid at response time so it is never served stale from a cached snapshot.
  body: {
    ok: boolean;
    app: string;
    providers: Array<{ provider: string; executable: string; available: boolean }>;
    storage: { writable: boolean };
  };
}

interface DataDirWritableProbe {
  writable: boolean;
  errno?: string;
}

export function createRoutes(options: RoutesOptions) {
  const router = express.Router();
  const logger = options.logger;
  const metrics = options.metrics ?? noopMetrics;
  const secrets = buildSecretMap(process.env);
  const sse = createSseHub({ logger, redact: (value) => redactSecrets(value, secrets) });
  const executor = options.executor ?? createCliExecutor({ logger, metrics });
  const providerHealthChecker = options.providerHealthChecker ?? checkExecutable;
  const healthCacheTtlMs = options.healthCacheTtlMs ?? DEFAULT_HEALTH_CACHE_TTL_MS;
  const healthMinIntervalMs = options.healthMinIntervalMs ?? DEFAULT_HEALTH_MIN_INTERVAL_MS;
  let healthCache: { snapshot: HealthSnapshot; cachedAt: number } | null = null;
  let healthInFlight: Promise<HealthSnapshot> | null = null;
  let lastHealthProbeStartedAt = 0;
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
    onSkip: async (flowId, reason) => {
      const run = skippedRun(flowId, reason);
      await options.storage.appendRun(run);
      sse.broadcast('run-complete', { run });
      return run;
    }
  });

  function syncSchedule(flow: PersistedFlow): void {
    if (flow.schedule?.enabled) {
      const intervalMs = validScheduleInterval(flow.schedule.intervalMs);
      if (intervalMs === null) {
        logger?.warn('schedule.invalidInterval', { flowId: flow.id });
        scheduler.unregister(flow.id);
        return;
      }
      scheduler.register(flow.id, {
        intervalMs,
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
    const snapshot = await getHealthSnapshot();
    // Overlay the live SSE client count so it is never served stale from the
    // cached probe snapshot.
    response.status(snapshot.statusCode).json({ ...snapshot.body, sseClients: sse.clientCount });
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
    if (!isAcceptableArtifactPath(relPath)) {
      logger?.warn('artifact.invalidPath', { relPath });
      response.status(400).json({ error: 'Invalid artifact path', code: 'INVALID_ARTIFACT_PATH' });
      return;
    }
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
      let contents: Buffer;
      try {
        const stats = await handle.stat();
        if (!stats.isFile()) {
          response.status(404).json({ error: 'Artifact not found' });
          return;
        }
        if (stats.size > MAX_ARTIFACT_BYTES) {
          response.status(413).json({ error: 'Artifact too large', code: 'ARTIFACT_TOO_LARGE' });
          return;
        }
        contents = await handle.readFile();
      } finally {
        await handle.close();
      }
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

  router.delete('/flows/:flowId', async (request, response) => {
    if (!ensureSafeFlowId(request, response)) {
      return;
    }
    const existed = await options.storage.deleteFlow(request.params.flowId);
    if (!existed) {
      response.status(404).json({ error: 'Flow not found' });
      return;
    }
    // Drop any registered schedule so a deleted flow never fires again.
    scheduler.unregister(request.params.flowId);
    logger?.info('flow.deleted', { flowId: request.params.flowId });
    response.status(204).end();
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
    const { flowId, nodeId, mode } = parsed.data;
    // Single-node debug runs use their own per-node rate-limit bucket so iterating
    // on one node neither throttles nor is throttled by full-flow runs — both still
    // spawn CLIs, so both stay throttled (security invariant 3).
    const rateKey = nodeId ? `${flowId}::${nodeId}` : flowId;
    if (!runRateLimiter.tryAcquire(rateKey)) {
      metrics.increment('run_rate_limited_total');
      logger?.warn('run.rateLimited', { flowId, nodeId: nodeId ?? null });
      response.status(429).json({
        error: 'Too many runs for this flow; please wait before retrying',
        code: 'RATE_LIMITED'
      });
      return;
    }
    let run: RunRecord;
    if (nodeId) {
      run = await runSingleNodeEphemeral(flowId, nodeId, mode as SingleNodeMode);
    } else {
      // Full-flow manual run: apply per-provider spacing so manual triggers can't
      // out-run the CLIs' throttling (invariant 3). Resolve the flow's providers;
      // a missing flow yields [] and falls through to runAndStore's not-found path.
      const flow = await options.storage.getFlow(flowId);
      const providers = flow ? flowProviders(flow) : [];
      run = (await scheduler.triggerNow(flowId, { providers, enforceSpacing: true })) as RunRecord;
    }
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
      // Merge the flow's webhook auth tokens (resolved from named env vars) into
      // the base CLI secret map so they are scrubbed from run records, the SSE
      // stream, and logs (security invariant 2).
      secrets: { ...secrets, ...collectWebhookSecrets(flow, process.env) },
      writeArtifact: createArtifactWriter(options.dataDir),
      emit: (event) => sse.broadcast('run-step', event),
      logger,
      metrics
    });
    await options.storage.appendRun(run);
    sse.broadcast('run-complete', { run });
    return run;
  }

  /**
   * Run ONE node in isolation. Ephemeral by design: the result streams over SSE
   * and is returned to the caller, but is NOT persisted to the flow's run history,
   * so debug runs never evict real runs from the per-flow cap. In cached-upstream
   * mode the latest persisted full run (one that actually executed nodes) supplies
   * the upstream sample.
   */
  async function runSingleNodeEphemeral(
    flowId: string,
    nodeId: string,
    mode: SingleNodeMode
  ): Promise<RunRecord> {
    const flow = await options.storage.getFlow(flowId);
    if (!flow) {
      logger?.warn('runNode.flowNotFound', { flowId });
      return failedRun(flowId, 'Flow not found');
    }
    let priorRun: RunRecord | null = null;
    if (mode === 'cached-upstream') {
      const runs = await options.storage.listRuns(flowId);
      priorRun = [...runs].reverse().find((candidate) => candidate.steps.length > 0) ?? null;
    }
    const run = await runSingleNode({
      flow,
      nodeId,
      mode,
      executor,
      // Single-node preview never fires a real webhook, but merge the tokens for
      // defense in depth so a resolved value can never surface in the output.
      secrets: { ...secrets, ...collectWebhookSecrets(flow, process.env) },
      emit: (event) => sse.broadcast('run-step', event),
      logger,
      metrics,
      priorRun
    });
    sse.broadcast('run-complete', { run });
    return run;
  }

  async function getHealthSnapshot(): Promise<HealthSnapshot> {
    const now = Date.now();
    if (healthCache && now - healthCache.cachedAt < healthCacheTtlMs) {
      return healthCache.snapshot;
    }
    if (healthInFlight) {
      return healthInFlight;
    }
    if (healthCache && now - lastHealthProbeStartedAt < healthMinIntervalMs) {
      return healthCache.snapshot;
    }

    lastHealthProbeStartedAt = now;
    healthInFlight = buildHealthSnapshot().finally(() => {
      healthInFlight = null;
    });
    const snapshot = await healthInFlight;
    healthCache = { snapshot, cachedAt: Date.now() };
    return snapshot;
  }

  async function buildHealthSnapshot(): Promise<HealthSnapshot> {
    const providers = await Promise.all(
      getProviderHealthCommands().map(async (command) => ({
        provider: command.provider,
        executable: command.executable,
        available: await providerHealthChecker(command.executable)
      }))
    );
    // `ok` reflects SERVER health — can the app persist runs? Missing CLI
    // binaries are a normal, separately-reported state (the app's job is to
    // detect and report them), not a server outage, so they do not flip `ok`.
    const storage = await isDataDirWritable(options.dataDir);
    const storageWritable = storage.writable;
    const ok = storageWritable;
    if (!ok) {
      logger?.error('health.degraded', {
        storageWritable,
        ...(storage.errno ? { errno: storage.errno } : {})
      });
    }
    return {
      statusCode: ok ? 200 : 503,
      body: { ok, app: 'Reddix', providers, storage: { writable: storageWritable } }
    };
  }

  function dispose(): void {
    scheduler.stop();
    sse.closeAll();
  }

  // Await in-flight runs before the process kills CLI children, so a flow mid-run
  // is never severed and its run record always persists. Called during shutdown
  // after dispose() has stopped the scheduler timer (no new scheduled work).
  function drainRuns(): Promise<void> {
    return scheduler.drain();
  }

  return { router, eventsHandler: sse.handler, closeClients: dispose, drainRuns };
}

/**
 * Probe whether the data directory can be written. Used by /health so a broken
 * data dir (the thing that actually fails runs) is reported, not masked behind
 * a hardcoded ok:true.
 */
async function isDataDirWritable(dataDir: string): Promise<DataDirWritableProbe> {
  try {
    await mkdir(dataDir, { recursive: true });
    await access(dataDir, constants.W_OK);
    return { writable: true };
  } catch (error) {
    return { writable: false, ...errorCodeField(error) };
  }
}

function errorCodeField(error: unknown): Pick<DataDirWritableProbe, 'errno'> {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return typeof code === 'string' ? { errno: code } : {};
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

function isAcceptableArtifactPath(relPath: string): boolean {
  if (relPath.length === 0 || relPath.length > MAX_ARTIFACT_REL_PATH_LENGTH) {
    return false;
  }
  return relPath.split('/').every((segment) => segment.length > 0 && segment.length <= MAX_ARTIFACT_SEGMENT_LENGTH);
}

function validScheduleInterval(intervalMs: unknown): number | null {
  if (intervalMs === undefined) {
    return MIN_SCHEDULE_INTERVAL_MS;
  }
  if (
    typeof intervalMs === 'number' &&
    Number.isInteger(intervalMs) &&
    intervalMs >= MIN_SCHEDULE_INTERVAL_MS &&
    intervalMs <= MAX_SCHEDULE_INTERVAL_MS
  ) {
    return intervalMs;
  }
  return null;
}

export function createArtifactWriter(dataDir: string) {
  const artifactsDir = artifactsDirFor(dataDir);
  return async (filePath: string, contents: string): Promise<{ path: string; bytes: number }> => {
    const safePath = resolveContainedPath(artifactsDir, filePath);
    await ensureArtifactParent(artifactsDir, path.dirname(safePath));
    const existing = await lstat(safePath).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') {
        return null;
      }
      throw error;
    });
    if (existing?.isSymbolicLink()) {
      throw new Error('Invalid artifact path: symlink target rejected');
    }
    if (existing?.isDirectory()) {
      throw new Error('Invalid artifact path: target is a directory');
    }
    if (existing && existing.nlink > 1) {
      throw new Error('Invalid artifact path: hard-linked target rejected');
    }
    const handle = await open(
      safePath,
      constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW,
      0o600
    );
    try {
      await handle.writeFile(contents);
    } finally {
      await handle.close();
    }
    return { path: filePath, bytes: Buffer.byteLength(contents) };
  };
}

async function ensureArtifactParent(artifactsDir: string, parentDir: string): Promise<void> {
  await mkdir(artifactsDir, { recursive: true });
  const realBase = await realpath(artifactsDir);
  const relative = path.relative(artifactsDir, parentDir);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Invalid artifact path: parent outside artifacts directory');
  }

  let current = artifactsDir;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    let stat = await lstat(current).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') {
        return null;
      }
      throw error;
    });
    if (!stat) {
      await mkdir(current);
      stat = await lstat(current);
    }
    if (stat.isSymbolicLink()) {
      throw new Error('Invalid artifact path: symlink parent rejected');
    }
    if (!stat.isDirectory()) {
      throw new Error('Invalid artifact path: parent is not a directory');
    }
  }

  const realParent = await realpath(parentDir);
  if (realParent !== realBase && !realParent.startsWith(realBase + path.sep)) {
    throw new Error('Invalid artifact path: parent outside artifacts directory');
  }
}

function failedRun(flowId: string, error: string): RunRecord {
  return makeTerminalRun({ flowId, status: 'failed', error });
}

function skippedRun(flowId: string, reason?: string): RunRecord {
  return makeTerminalRun({
    flowId,
    status: 'skipped',
    error:
      reason === 'provider-spacing'
        ? 'Skipped to respect per-provider request spacing; retry shortly'
        : 'Skipped because a previous run is still in flight'
  });
}
