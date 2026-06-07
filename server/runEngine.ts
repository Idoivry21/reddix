import { nanoid } from 'nanoid';
import { buildBlockCommand } from '../src/shared/commandBuilders';
import { buildTimestampedExportPath, serializeCsv, serializeJson, serializeMarkdown } from '../src/shared/exporters';
import { serializeHtml } from '../src/shared/htmlReport';
import { resolveInputBoundSettings } from '../src/shared/inputBindings';
import type { FlowEdgeModel, FlowNodeModel } from '../src/shared/graph';
import { validateFlow } from '../src/shared/graph';
import { normalizeRedditPayload, normalizeTwitterPayload } from '../src/shared/normalizers';
import { redactSecrets } from '../src/shared/redaction';
import type { SecretMap } from '../src/shared/redaction';
import { MAX_SAMPLE_ROWS } from '../src/shared/runLimits';
import { applyEngagementFilter, applyFilterText, applyLimit, applyMerge, applySort } from '../src/shared/transforms';
import type { RunSampleRow, SocialItem } from '../src/shared/types';
import type { EventLogger } from './logger';
import { noopMetrics, type Metrics } from './metrics';
import { makeTerminalRun } from './runRecord';
import type { CliExecutor, FlowDefinition, RunRecord, RunStep } from './types';

interface RunFlowOptions {
  flow: FlowDefinition;
  executor: CliExecutor;
  writeArtifact: (filePath: string, contents: string) => Promise<{ path: string; bytes: number }>;
  /**
   * Secret values (e.g. auth tokens) to scrub from every persisted/broadcast
   * string. Security invariant 2: secrets must never reach run records, the SSE
   * stream, or logs even if a CLI echoes them to stderr/stdout.
   */
  secrets?: SecretMap;
  now?: () => Date;
  emit?: (event: { type: string; step?: RunStep }) => void;
  /** Optional structured logger; flow/step lifecycle is logged when provided. */
  logger?: EventLogger;
  /** Optional metrics sink for run/step counters and durations. */
  metrics?: Metrics;
}

export async function runFlow(options: RunFlowOptions): Promise<RunRecord> {
  const now = options.now ?? (() => new Date());
  const secrets = options.secrets ?? {};
  const logger = options.logger;
  const metrics = options.metrics ?? noopMetrics;
  const flowId = options.flow.id;
  const redact = (value: string): string => redactSecrets(value, secrets);
  const redactArgv = (value: string[]): string[] => redactSecrets(value, secrets);
  const startedAt = now().toISOString();
  const validation = validateFlow(options.flow);
  if (!validation.valid) {
    logger?.warn('flow.invalid', {
      flowId,
      errors: validation.errors.length
    });
    metrics.increment('flow_runs_total', { status: 'failed' });
    return makeTerminalRun({
      flowId: options.flow.id,
      status: 'failed',
      error: validation.errors.map((error) => error.message).join('; '),
      now
    });
  }

  const nodes = topologicalNodes(options.flow);
  const edgesByTarget = groupEdges(options.flow.edges, 'target');
  const edgesBySource = groupEdges(options.flow.edges, 'source');
  const data = new Map<string, SocialItem[]>();
  const blocked = new Set<string>();
  const steps: RunStep[] = [];
  const outputFiles: Array<{ path: string; bytes: number }> = [];
  // Capped, redacted preview of what the flow produced — last export wins,
  // mirroring how the latest HTML report is surfaced to the console.
  let sample: RunSampleRow[] = [];
  let failed = false;

  const flowStart = now().getTime();
  logger?.info('flow.start', { flowId, nodeCount: nodes.length });

  // Single place that records a step: pushes it, streams it over SSE, and logs
  // structural fields only (never stderr/error/argv content, which may carry a
  // token even after redaction — keep the log surface minimal).
  const recordStep = (step: RunStep, nodeType: string): void => {
    steps.push(step);
    options.emit?.({ type: 'step', step });
    logger?.info('flow.step', {
      flowId,
      blockId: step.blockId,
      type: nodeType,
      status: step.status,
      exitCode: step.exitCode ?? null,
      durationMs: Date.parse(step.endedAt) - Date.parse(step.startedAt)
    });
    if (step.status === 'failed') {
      metrics.increment('step_failed_total', { type: nodeType });
    }
  };

  const nodeCtx: NodeRunContext = {
    executor: options.executor,
    writeArtifact: options.writeArtifact,
    flowName: options.flow.name,
    flowId,
    now,
    redact,
    redactArgv,
    logger
  };

  for (const node of nodes) {
    const dependencyEdges = edgesByTarget.get(node.id) ?? [];
    const dependencyBlocked =
      blocked.has(node.id) || dependencyEdges.some((edge) => blocked.has(edge.source));
    if (dependencyBlocked) {
      const step = makeStep(node.id, 'skipped', now, { error: 'Skipped because an upstream step failed' });
      recordStep(step, node.type);
      markDownstreamBlocked(node.id, edgesBySource, blocked);
      continue;
    }

    const stepStarted = now().toISOString();
    try {
      const inputItems = dependencyEdges.flatMap((edge) => data.get(edge.source) ?? []);
      if (isCliNode(node)) {
        const outcome = await runCliNode(node, inputItems, stepStarted, nodeCtx);
        recordStep(outcome.step, node.type);
        if (outcome.items) {
          data.set(node.id, outcome.items);
        }
        if (outcome.failed) {
          failed = true;
          markDownstreamBlocked(node.id, edgesBySource, blocked);
          if (options.flow.failFast) {
            break;
          }
        }
        continue;
      }

      const outcome = await runLocalNode(node, inputItems, nodeCtx);
      if (outcome.items) {
        data.set(node.id, outcome.items);
      }
      if (outcome.artifact) {
        outputFiles.push(outcome.artifact);
      }
      if (outcome.sample) {
        sample = outcome.sample;
      }

      // For transforms, log input vs output counts so "filter dropped 100→0"
      // (intentional) is distinguishable from "filter is broken" (a bug). For
      // mergeStreams this also surfaces how many duplicates were dropped.
      if (node.type.startsWith('transform.')) {
        const outCount = data.get(node.id)?.length ?? 0;
        logger?.info('flow.transform', {
          flowId,
          blockId: node.id,
          type: node.type,
          inputCount: inputItems.length,
          outputCount: outCount,
          dropped: inputItems.length - outCount
        });
      }

      const step = makeStep(node.id, 'success', now, { startedAt: stepStarted });
      recordStep(step, node.type);
    } catch (error) {
      failed = true;
      // The error message lands in the step record; the log adds the operation
      // class so a thrown transform/export/parse error is not an anonymous 500.
      logger?.error('flow.stepError', {
        flowId,
        blockId: node.id,
        type: node.type,
        operation: operationOf(node),
        detail: redact(error instanceof Error ? error.message : String(error))
      });
      const step = makeStep(node.id, 'failed', now, {
        startedAt: stepStarted,
        error: redact(error instanceof Error ? error.message : String(error))
      });
      recordStep(step, node.type);
      markDownstreamBlocked(node.id, edgesBySource, blocked);
      if (options.flow.failFast) {
        break;
      }
    }
  }

  // Flows without an output node still get a preview: fall back to the largest
  // collected dataset (the most-downstream data-producing node, approximately).
  if (sample.length === 0) {
    let largest: SocialItem[] = [];
    for (const items of data.values()) {
      if (items.length > largest.length) {
        largest = items;
      }
    }
    sample = toSampleRows(largest, redact);
  }

  const status = failed ? 'failed' : 'success';
  const durationMs = now().getTime() - flowStart;
  const counts = countStatuses(steps);
  metrics.increment('flow_runs_total', { status });
  metrics.observe('flow_duration_ms', durationMs, { status });
  logger?.info('flow.end', {
    flowId,
    status,
    durationMs,
    steps: steps.length,
    succeeded: counts.success,
    failed: counts.failed,
    skipped: counts.skipped
  });

  return {
    schemaVersion: 1,
    id: nanoid(),
    flowId: options.flow.id,
    status,
    startedAt,
    endedAt: now().toISOString(),
    steps,
    outputFiles,
    error: failed ? 'One or more steps failed' : null,
    sample
  };
}

/** Shared closures/dependencies a single node needs to run, built once per flow. */
interface NodeRunContext {
  executor: CliExecutor;
  writeArtifact: RunFlowOptions['writeArtifact'];
  flowName: string;
  flowId: string;
  now: () => Date;
  redact: (value: string) => string;
  redactArgv: (value: string[]) => string[];
  logger?: EventLogger;
}

/**
 * Run one CLI-backed node: build the argv, execute, and map the result to a
 * RunStep. Returns the (success or failed) step plus, on success, the normalized
 * items; `failed` tells the caller to block downstream nodes. The shared step
 * fields are built once (`base`) so the redaction/summary convention can't drift
 * between the success and failure records.
 */
async function runCliNode(
  node: FlowNodeModel,
  inputItems: SocialItem[],
  stepStarted: string,
  ctx: NodeRunContext
): Promise<{ step: RunStep; items?: SocialItem[]; failed: boolean }> {
  const settings = resolveInputBoundSettings(node.type, node.settings, inputItems);
  const command = buildBlockCommand({ blockId: node.id, blockType: node.type, settings });
  const result = await ctx.executor(command);
  const base = {
    blockId: node.id,
    argv: ctx.redactArgv(command.displayArgv),
    exitCode: result.exitCode,
    stdoutSummary: summarizeStdout(ctx.redact(result.stdout)),
    stderr: ctx.redact(result.stderr),
    startedAt: stepStarted,
    endedAt: ctx.now().toISOString()
  };

  // CLIs report logical failures via a `{ ok: false, error }` JSON envelope on
  // stdout (often with empty stderr), and usually a non-zero exit. Treat either
  // signal as a failure and surface the envelope's human message instead of a
  // bare "Command exited with N".
  const envelopeError = parseEnvelopeError(result.stdout);
  if (result.exitCode !== 0 || envelopeError) {
    const message = envelopeError ?? (result.stderr.trim() || `Command exited with ${result.exitCode}`);
    return { step: { ...base, status: 'failed', error: ctx.redact(message) }, failed: true };
  }

  // Exit 0 with empty stdout is treated as "no results", but it can also mask an
  // auth/network failure that produced no output. Warn so the two are distinguishable.
  if (!result.stdout.trim()) {
    ctx.logger?.warn('cli.emptyStdout', {
      flowId: ctx.flowId,
      blockId: node.id,
      provider: command.provider,
      exitCode: result.exitCode,
      stderr: summarizeStdout(ctx.redact(result.stderr))
    });
  }

  const payload = parseJson(result.stdout);
  const onUnrecognized = (info: { keys: string[] }): void => {
    ctx.logger?.warn('cli.unrecognizedPayload', {
      flowId: ctx.flowId,
      blockId: node.id,
      provider: command.provider,
      keys: info.keys
    });
  };
  const items =
    command.provider === 'reddit'
      ? normalizeRedditPayload(payload, node.id, onUnrecognized)
      : normalizeTwitterPayload(payload, node.id, onUnrecognized);
  return { step: { ...base, status: 'success' }, items, failed: false };
}

/**
 * Run one local (transform/output/passthrough) node. Returns the items it
 * produced, or — for an output node — the written artifact plus the sample
 * preview. The caller owns recording the step and the transform-count logging.
 */
async function runLocalNode(
  node: FlowNodeModel,
  inputItems: SocialItem[],
  ctx: NodeRunContext
): Promise<{ items?: SocialItem[]; artifact?: { path: string; bytes: number }; sample?: RunSampleRow[] }> {
  switch (node.type) {
    case 'transform.limit':
      return { items: applyLimit(inputItems, node.settings) };
    case 'transform.filterText':
      return { items: applyFilterText(inputItems, node.settings) };
    case 'transform.engagementFilter':
      return { items: applyEngagementFilter(inputItems, node.settings) };
    case 'transform.sortLocal':
      return { items: applySort(inputItems, node.settings) };
    case 'transform.mergeStreams':
      return { items: applyMerge(inputItems) };
  }
  if (node.type.startsWith('output.')) {
    const artifact = await writeOutput(node, inputItems, ctx.writeArtifact, ctx.now(), ctx.flowName);
    return { artifact, sample: toSampleRows(inputItems, ctx.redact) };
  }
  return { items: inputItems };
}

/** Coarse operation class for a node, used to label step-failure logs. */
function operationOf(node: FlowNodeModel): string {
  if (isCliNode(node)) {
    return 'cli';
  }
  if (node.type.startsWith('output.')) {
    return 'export';
  }
  return 'transform';
}

function countStatuses(steps: RunStep[]): { success: number; failed: number; skipped: number } {
  return steps.reduce(
    (counts, step) => {
      if (step.status === 'success') counts.success += 1;
      else if (step.status === 'failed') counts.failed += 1;
      else if (step.status === 'skipped') counts.skipped += 1;
      return counts;
    },
    { success: 0, failed: 0, skipped: 0 }
  );
}

/**
 * Project normalized items into the flattened, redacted RunSampleRow shape.
 * Every string field passes through `redact` (security invariant 2) so a token
 * echoed into a post body can never reach the run record or SSE stream.
 */
function toSampleRows(
  items: SocialItem[],
  redact: (value: string) => string,
  max = MAX_SAMPLE_ROWS
): RunSampleRow[] {
  return items.slice(0, max).map((item) => ({
    platform: item.platform,
    id: item.id,
    title: redactNullable(item.title ?? item.body ?? (item.text || null), redact),
    author: redactNullable(item.author, redact),
    score: item.engagement.score ?? item.engagement.likes ?? null,
    created: item.createdAt || null,
    url: redactNullable(item.url, redact)
  }));
}

function redactNullable(value: string | null, redact: (value: string) => string): string | null {
  return value === null ? null : redact(value);
}

function isCliNode(node: FlowNodeModel): boolean {
  return node.type.startsWith('reddit.') || node.type.startsWith('twitter.');
}

function topologicalNodes(flow: FlowDefinition): FlowNodeModel[] {
  const nodesById = new Map(flow.nodes.map((node) => [node.id, node]));
  const incoming = new Map(flow.nodes.map((node) => [node.id, 0]));
  const outgoing = groupEdges(flow.edges, 'source');
  for (const edge of flow.edges) {
    incoming.set(edge.target, (incoming.get(edge.target) ?? 0) + 1);
  }
  const queue = flow.nodes.filter((node) => (incoming.get(node.id) ?? 0) === 0);
  const ordered: FlowNodeModel[] = [];
  for (let index = 0; index < queue.length; index += 1) {
    const node = queue[index];
    ordered.push(node);
    for (const edge of outgoing.get(node.id) ?? []) {
      incoming.set(edge.target, (incoming.get(edge.target) ?? 0) - 1);
      if ((incoming.get(edge.target) ?? 0) === 0) {
        const target = nodesById.get(edge.target);
        if (target) {
          queue.push(target);
        }
      }
    }
  }
  return ordered;
}

function groupEdges(edges: FlowEdgeModel[], key: 'source' | 'target'): Map<string, FlowEdgeModel[]> {
  const groups = new Map<string, FlowEdgeModel[]>();
  for (const edge of edges) {
    const group = groups.get(edge[key]);
    if (group) {
      group.push(edge);
    } else {
      groups.set(edge[key], [edge]);
    }
  }
  return groups;
}

function markDownstreamBlocked(
  nodeId: string,
  edgesBySource: Map<string, FlowEdgeModel[]>,
  blocked: Set<string>
) {
  const queue = [nodeId];
  const visited = new Set<string>();
  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index];
    if (visited.has(current)) {
      continue;
    }
    visited.add(current);
    for (const edge of edgesBySource.get(current) ?? []) {
      if (!blocked.has(edge.target)) {
        blocked.add(edge.target);
        queue.push(edge.target);
      }
    }
  }
}

function makeStep(
  blockId: string,
  status: RunStep['status'],
  now: () => Date,
  overrides: Partial<RunStep> = {}
): RunStep {
  const startedAt = overrides.startedAt ?? now().toISOString();
  return {
    blockId,
    status,
    startedAt,
    endedAt: now().toISOString(),
    exitCode: null,
    error: null,
    ...overrides
  };
}

function parseJson(stdout: string): unknown {
  return stdout.trim() ? JSON.parse(stdout) : { data: [] };
}

/**
 * Extract a human-readable error from a CLI `{ ok: false, error }` envelope on
 * stdout. Returns null when stdout is not such an envelope (e.g. plain success
 * payload or non-JSON), so callers can fall back to stderr/exit code.
 */
function parseEnvelopeError(stdout: string): string | null {
  if (!stdout.trim()) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return null;
  }
  const envelope = parsed as { ok?: unknown; error?: unknown };
  if (envelope.ok !== false) {
    return null;
  }
  const error = envelope.error;
  if (typeof error === 'string') {
    return error.trim() || 'Command reported an error';
  }
  if (typeof error === 'object' && error !== null) {
    const { message, code } = error as { message?: unknown; code?: unknown };
    const messageText = typeof message === 'string' && message.trim() ? message : null;
    const codeText = typeof code === 'string' && code.trim() ? code : null;
    if (messageText && codeText) {
      return `${messageText} (${codeText})`;
    }
    return messageText ?? codeText ?? 'Command reported an error';
  }
  return 'Command reported an error';
}

// Caps how much CLI stdout/stderr is persisted into each RunStep and streamed
// over SSE, so run records stay bounded.
const STDOUT_SUMMARY_MAX_CHARS = 240;

function summarizeStdout(stdout: string): string {
  return stdout.length > STDOUT_SUMMARY_MAX_CHARS
    ? `${stdout.slice(0, STDOUT_SUMMARY_MAX_CHARS)}...`
    : stdout;
}

async function writeOutput(
  node: FlowNodeModel,
  items: SocialItem[],
  writeArtifact: RunFlowOptions['writeArtifact'],
  now: Date,
  flowName: string
): Promise<{ path: string; bytes: number }> {
  const rawPath = typeof node.settings.path === 'string' ? node.settings.path : 'outputs/export.json';
  const filePath = buildTimestampedExportPath(rawPath, now);
  if (node.type === 'output.exportCsv') {
    return writeArtifact(filePath, serializeCsv(items));
  }
  if (node.type === 'output.exportMarkdown') {
    return writeArtifact(filePath, serializeMarkdown(items));
  }
  if (node.type === 'output.exportHtml') {
    return writeArtifact(filePath, serializeHtml(items, { flowName, generatedAt: now.toISOString() }));
  }
  return writeArtifact(filePath, serializeJson(items, node.settings.pretty !== false));
}
