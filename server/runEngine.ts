import { nanoid } from 'nanoid';
import { buildBlockCommand, getBlockSpec } from '../src/shared/commandBuilders';
import { buildTimestampedExportPath, serializeCsv, serializeJson, serializeMarkdown } from '../src/shared/exporters';
import { serializeHtml } from '../src/shared/htmlReport';
import {
  blankBoundFieldKeys,
  resolveInputBoundSettings,
  resolveInputBoundSettingsForItem
} from '../src/shared/inputBindings';
import type { FlowEdgeModel, FlowNodeModel } from '../src/shared/graph';
import { validateFlow } from '../src/shared/graph';
import { normalizeRedditPayload, normalizeTwitterPayload } from '../src/shared/normalizers';
import { redactSecrets } from '../src/shared/redaction';
import type { SecretMap } from '../src/shared/redaction';
import {
  MAX_FANOUT_CALLS,
  MAX_NODE_OUTPUT_ITEMS,
  MAX_SAMPLE_ROWS,
  MAX_SAMPLE_TEXT_CHARS,
  MAX_STEP_SAMPLE_ITEMS
} from '../src/shared/runLimits';
import { applyEngagementFilter, applyFilterText, applyLimit, applyMerge, applySort } from '../src/shared/transforms';
import type {
  BuiltCommand,
  RunSampleMeta,
  RunSampleRow,
  RunStepIo,
  RunStepSampleItem,
  SingleNodeMode,
  SocialItem
} from '../src/shared/types';
import type { EventLogger } from './logger';
import { computeFlowGraphHash } from './flowHash';
import { noopMetrics, type Metrics } from './metrics';
import { makeTerminalRun } from './runRecord';
import { maskWebhookUrl, postWebhook } from './webhook';
import type { PostWebhookInput, WebhookResult } from './webhook';
import type { CliExecutor, FlowDefinition, RunRecord, RunStep } from './types';

interface RunFlowOptions {
  flow: FlowDefinition;
  executor: CliExecutor;
  writeArtifact: (filePath: string, contents: string) => Promise<{ path: string; bytes: number }>;
  /** Override the webhook delivery function — tests inject a spy. Defaults to the
   *  real {@link postWebhook}, which opens an HTTPS socket to a third-party host. */
  sendWebhook?: (input: PostWebhookInput) => Promise<WebhookResult>;
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
  const runId = nanoid();
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
      runId,
      flowId,
      errors: validation.errors.length
    });
    metrics.increment('flow_runs_total', { status: 'failed' });
    return {
      ...makeTerminalRun({
        flowId: options.flow.id,
        status: 'failed',
        error: validation.errors.map((error) => error.message).join('; '),
        now
      }),
      id: runId
    };
  }

  const nodes = topologicalNodes(options.flow);
  const edgesByTarget = groupEdges(options.flow.edges, 'target');
  const edgesBySource = groupEdges(options.flow.edges, 'source');
  const data = new Map<string, SocialItem[]>();
  // Reference-count each source node's downstream consumers so its output can be
  // freed from `data` once every consumer has run — bounding peak memory to the
  // working set instead of the sum of all node outputs. Decrement only when a node
  // is fully done, so we can under-count (a harmless leak) but never free early.
  const remainingConsumers = new Map<string, number>();
  for (const [source, sourceEdges] of edgesBySource) {
    remainingConsumers.set(source, new Set(sourceEdges.map((edge) => edge.target)).size);
  }
  const releaseConsumedInputs = (consumerNodeId: string): void => {
    const sources = new Set((edgesByTarget.get(consumerNodeId) ?? []).map((edge) => edge.source));
    for (const source of sources) {
      const left = (remainingConsumers.get(source) ?? 0) - 1;
      remainingConsumers.set(source, left);
      if (left <= 0) {
        data.delete(source);
      }
    }
  };
  // Track the largest dataset incrementally for the no-output-node fallback preview
  // so eviction can drop `data` entries without a post-loop scan losing them. The
  // winning array (one capped node's worth) is retained by reference even after it
  // leaves `data`.
  let fallbackLargest: SocialItem[] = [];
  let fallbackNodeId: string | null = null;
  const trackFallback = (nodeId: string, items: SocialItem[]): void => {
    if (items.length >= fallbackLargest.length) {
      fallbackLargest = items;
      fallbackNodeId = nodeId;
    }
  };
  const blocked = new Set<string>();
  const steps: RunStep[] = [];
  const outputFiles: Array<{ path: string; bytes: number }> = [];
  // Capped, redacted preview of what the flow produced — last export wins,
  // mirroring how the latest HTML report is surfaced to the console.
  let sample: RunSampleRow[] = [];
  // Provenance for the sample so the console can caption it (which node, saved?).
  let sampleMeta: RunSampleMeta | undefined;
  let failed = false;

  const flowStart = now().getTime();
  logger?.info('flow.start', { runId, flowId, nodeCount: nodes.length });

  // Single place that records a step: pushes it, streams it over SSE, and logs
  // structural fields only (never stderr/error/argv content, which may carry a
  // token even after redaction — keep the log surface minimal).
  const recordStep = (step: RunStep, nodeType: string): void => {
    steps.push(step);
    options.emit?.({ type: 'step', step });
    logger?.info('flow.step', {
      runId,
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
    sendWebhook: options.sendWebhook ?? postWebhook,
    secrets,
    flowName: options.flow.name,
    flowId,
    runId,
    now,
    redact,
    redactArgv,
    logger
  };

  for (const node of nodes) {
    // Wrapped so a node's consumed upstream outputs are released on EVERY exit
    // path (skip/continue/break/throw), exactly once — see releaseConsumedInputs.
    try {
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
          trackFallback(node.id, outcome.items);
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

      // Webhook is a terminal sink (no output port): dispatch it before the
      // generic local-node path so it builds a status-bearing step and can fail
      // the flow under failFast, mirroring the CLI-node dispatch above.
      if (isWebhookNode(node)) {
        const outcome = await runWebhookNode(node, inputItems, stepStarted, nodeCtx);
        recordStep(outcome.step, node.type);
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
        trackFallback(node.id, outcome.items);
      }
      if (outcome.artifact) {
        outputFiles.push(outcome.artifact);
      }
      if (outcome.sample) {
        sample = outcome.sample;
        sampleMeta = { sourceLabel: getBlockSpec(node.type).label, saved: true, totalItems: inputItems.length };
      }

      // Output nodes pass their input through (they consume items and write a
      // file); transforms produce a new array. Either way the produced array is
      // what the I/O preview reports and what `skippedCount` is measured against.
      const producedItems = outcome.items ?? inputItems;

      // For transforms, log input vs output counts so "filter dropped 100→0"
      // (intentional) is distinguishable from "filter is broken" (a bug). For
      // mergeStreams this also surfaces how many duplicates were dropped.
      if (node.type.startsWith('transform.')) {
        logger?.info('flow.transform', {
          flowId,
          blockId: node.id,
          type: node.type,
          inputCount: inputItems.length,
          outputCount: producedItems.length,
          dropped: inputItems.length - producedItems.length
        });
      }

      const step = makeStep(node.id, 'success', now, {
        startedAt: stepStarted,
        io: makeStepIo(inputItems, producedItems, Math.max(0, inputItems.length - producedItems.length), redact)
      });
      recordStep(step, node.type);
    } catch (error) {
      failed = true;
      const detail = redact(error instanceof Error ? error.message : String(error));
      const stack = error instanceof Error && error.stack ? redact(error.stack) : null;
      // The error message lands in the step record; the log adds the operation
      // class so a thrown transform/export/parse error is not an anonymous 500.
      logger?.error('flow.stepError', {
        runId,
        flowId,
        blockId: node.id,
        type: node.type,
        operation: operationOf(node),
        detail,
        stack
      });
      const step = makeStep(node.id, 'failed', now, {
        startedAt: stepStarted,
        error: detail
      });
      recordStep(step, node.type);
      markDownstreamBlocked(node.id, edgesBySource, blocked);
      if (options.flow.failFast) {
        break;
      }
    }
    } finally {
      releaseConsumedInputs(node.id);
    }
  }

  // Flows without an output node still get a preview: fall back to the largest
  // collected dataset. Ties go to the later (more-downstream) node — `trackFallback`
  // runs in topological order — so the preview names the node closest to the end of
  // the flow, which is what the user thinks of as "the output". Marked unsaved so the
  // caption can tell the user nothing was written to a file. Tracked incrementally
  // (not via a post-loop scan of `data`) so output eviction can't hide a node.
  if (sample.length === 0) {
    sample = toSampleRows(fallbackLargest, redact);
    if (fallbackNodeId && fallbackLargest.length > 0) {
      const producer = nodes.find((node) => node.id === fallbackNodeId);
      sampleMeta = {
        sourceLabel: producer ? getBlockSpec(producer.type).label : fallbackNodeId,
        saved: false,
        totalItems: fallbackLargest.length
      };
    }
  }

  const status = failed ? 'failed' : 'success';
  const durationMs = now().getTime() - flowStart;
  const counts = countStatuses(steps);
  metrics.increment('flow_runs_total', { status });
  metrics.observe('flow_duration_ms', durationMs, { status });
  logger?.info('flow.end', {
    runId,
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
    id: runId,
    flowId: options.flow.id,
    status,
    startedAt,
    endedAt: now().toISOString(),
    steps,
    outputFiles,
    error: failed ? 'One or more steps failed' : null,
    sample,
    sampleMeta,
    // Tag the run with the flow structure it executed so a later cached-upstream
    // single-node run can detect edits and refuse to feed stale cached samples.
    flowGraphHash: computeFlowGraphHash(options.flow)
  };
}

export interface RunSingleNodeOptions {
  flow: FlowDefinition;
  nodeId: string;
  mode: SingleNodeMode;
  executor: CliExecutor;
  secrets?: SecretMap;
  now?: () => Date;
  emit?: (event: { type: string; step?: RunStep }) => void;
  logger?: EventLogger;
  metrics?: Metrics;
  /** Most recent persisted FULL run, used to source cached upstream samples in
   *  'cached-upstream' mode. Null/absent when no prior run exists. */
  priorRun?: RunRecord | null;
}

/**
 * Run ONE node in isolation for debugging. `static` mode feeds it nothing (it
 * runs on its own settings); `cached-upstream` mode feeds it the cached output
 * sample of its immediate upstream nodes from the last full run. Output nodes do
 * NOT write artifacts here — a "preview this node" action stays side-effect free.
 * Returns a one-step RunRecord tagged as a single-node run; the route keeps these
 * ephemeral (not persisted to flow history).
 */
export async function runSingleNode(options: RunSingleNodeOptions): Promise<RunRecord> {
  const now = options.now ?? (() => new Date());
  const secrets = options.secrets ?? {};
  const runId = nanoid();
  const logger = options.logger;
  const metrics = options.metrics ?? noopMetrics;
  const flowId = options.flow.id;
  const redact = (value: string): string => redactSecrets(value, secrets);
  const redactArgv = (value: string[]): string[] => redactSecrets(value, secrets);
  const startedAt = now().toISOString();

  const validation = validateFlow(options.flow);
  if (!validation.valid) {
    return makeTerminalRun({
      flowId,
      status: 'failed',
      error: validation.errors.map((error) => error.message).join('; '),
      now
    });
  }

  const node = options.flow.nodes.find((candidate) => candidate.id === options.nodeId);
  if (!node) {
    return makeTerminalRun({ flowId, status: 'failed', error: `Node ${options.nodeId} not found in flow`, now });
  }

  // Source inputs. static → none. cached-upstream → reconstruct items from the
  // previous full run's per-node sample for each immediate upstream node.
  let inputItems: SocialItem[] = [];
  if (options.mode === 'cached-upstream') {
    const upstreamIds = options.flow.edges
      .filter((edge) => edge.target === node.id)
      .map((edge) => edge.source);
    if (upstreamIds.length === 0) {
      // A source/standalone node has nothing upstream — behave like static.
      logger?.info('runNode.noUpstream', { flowId, blockId: node.id });
    } else if (!options.priorRun) {
      return makeTerminalRun({
        flowId,
        status: 'failed',
        error: 'No previous full run to source cached upstream from. Run the full flow first.',
        now
      });
    } else if (options.priorRun.flowGraphHash && options.priorRun.flowGraphHash !== computeFlowGraphHash(options.flow)) {
      // The cached run was produced from a different flow version (e.g. an upstream
      // query was edited or the graph rewired). Feeding its samples would silently
      // serve stale data, so refuse and require a fresh full run.
      return makeTerminalRun({
        flowId,
        status: 'failed',
        error: 'Flow changed since the cached full run; run the full flow again before using cached upstream.',
        now
      });
    } else {
      const gathered: SocialItem[] = [];
      for (const sourceId of upstreamIds) {
        const step = options.priorRun.steps.find((candidate) => candidate.blockId === sourceId);
        if (!step?.io) {
          return makeTerminalRun({
            flowId,
            status: 'failed',
            error: `Upstream node ${sourceId} has no cached output; run the full flow first.`,
            now
          });
        }
        gathered.push(...step.io.sampleItems.map(sampleItemToSocialItem));
      }
      inputItems = gathered;
    }
  }

  const ctx: NodeRunContext = {
    executor: options.executor,
    // Single-node runs never touch disk — compute counts/sample, write nothing.
    writeArtifact: async () => ({ path: '', bytes: 0 }),
    // Side-effect-free preview: never fire a live webrequest from "preview this
    // node" — return a success result labeled as a preview instead.
    sendWebhook: async (input) => ({
      ok: true,
      statusCode: null,
      error: null,
      summary: `POST ${maskWebhookUrl(input.url)} → preview (not sent)`
    }),
    secrets,
    flowName: options.flow.name,
    flowId,
    runId,
    now,
    redact,
    redactArgv,
    logger
  };

  const stepStarted = now().toISOString();
  let step: RunStep;
  let failed = false;
  try {
    if (isCliNode(node)) {
      const outcome = await runCliNode(node, inputItems, stepStarted, ctx);
      step = outcome.step;
      failed = outcome.failed;
    } else if (isWebhookNode(node)) {
      const outcome = await runWebhookNode(node, inputItems, stepStarted, ctx);
      step = outcome.step;
      failed = outcome.failed;
    } else {
      const local = await runLocalNode(node, inputItems, ctx);
      const produced = local.items ?? inputItems;
      step = makeStep(node.id, 'success', now, {
        startedAt: stepStarted,
        io: makeStepIo(inputItems, produced, Math.max(0, inputItems.length - produced.length), redact)
      });
    }
  } catch (error) {
    failed = true;
    logger?.error('runNode.stepError', {
      flowId,
      blockId: node.id,
      operation: operationOf(node),
      detail: redact(error instanceof Error ? error.message : String(error))
    });
    step = makeStep(node.id, 'failed', now, {
      startedAt: stepStarted,
      error: redact(error instanceof Error ? error.message : String(error)),
      io: makeStepIo(inputItems, [], 0, redact)
    });
  }

  options.emit?.({ type: 'step', step });
  metrics.increment('node_runs_total', { status: failed ? 'failed' : 'success' });
  logger?.info('runNode.end', { flowId, blockId: node.id, mode: options.mode, status: step.status });

  const sampleItems = step.io?.sampleItems ?? [];
  return {
    schemaVersion: 1,
    id: runId,
    flowId,
    status: failed ? 'failed' : 'success',
    startedAt,
    endedAt: now().toISOString(),
    steps: [step],
    outputFiles: [],
    error: failed ? step.error ?? 'Node run failed' : null,
    sample: stepSampleToRows(sampleItems),
    sampleMeta:
      sampleItems.length > 0
        ? {
            sourceLabel: getBlockSpec(node.type).label,
            saved: false,
            totalItems: step.io?.outputCount ?? sampleItems.length
          }
        : undefined,
    trigger: { kind: 'single-node', nodeId: node.id, mode: options.mode }
  };
}

/** Shared closures/dependencies a single node needs to run, built once per flow. */
interface NodeRunContext {
  executor: CliExecutor;
  writeArtifact: RunFlowOptions['writeArtifact'];
  /** Delivers a webhook POST. Real `postWebhook` in a full run; a side-effect-free
   *  no-op in single-node preview so "preview this node" never fires a request. */
  sendWebhook: (input: PostWebhookInput) => Promise<WebhookResult>;
  /** Run secret map (auth tokens). Also the source of a webhook node's resolved
   *  bearer token, keyed by its `authTokenEnvVar` name. */
  secrets: SecretMap;
  flowName: string;
  flowId: string;
  /** This run's id, threaded into the webhook envelope. */
  runId: string;
  now: () => Date;
  redact: (value: string) => string;
  redactArgv: (value: string[]) => string[];
  logger?: EventLogger;
}

/** One CLI invocation's normalized outcome. `error !== null` marks a logical or
 * exec failure; on success `items` carries the normalized payload. Used by both
 * the single-call and fan-out paths so they share one execute/parse convention. */
interface CliCallResult {
  items: SocialItem[];
  displayArgv: string[];
  exitCode: number;
  stdout: string;
  stderr: string;
  error: string | null;
}

/**
 * Run one CLI-backed node: build the argv, execute, and map the result to a
 * RunStep. Returns the (success or failed) step plus, on success, the normalized
 * items; `failed` tells the caller to block downstream nodes.
 *
 * A wired enrichment block with a blank input-bound field (e.g. Tweet Detail
 * downstream of Search Tweets) fans out — one CLI call per distinct upstream item
 * — instead of a single command. Otherwise the field carries a static value (or
 * the block has no binding) and a single command runs as before.
 */
async function runCliNode(
  node: FlowNodeModel,
  inputItems: SocialItem[],
  stepStarted: string,
  ctx: NodeRunContext
): Promise<{ step: RunStep; items?: SocialItem[]; failed: boolean }> {
  const blankKeys = blankBoundFieldKeys(node.type, node.settings);
  if (blankKeys.length > 0 && inputItems.length > 0) {
    return runFanOutCliNode(node, inputItems, blankKeys, stepStarted, ctx);
  }

  // resolveInputBoundSettings throws when a blank bound field has no upstream
  // value to fill it (blank field + no incoming items) — the outer runFlow catch
  // turns that into a failed step, as before.
  const settings = resolveInputBoundSettings(node.type, node.settings, inputItems);
  const command = buildBlockCommand({ blockId: node.id, blockType: node.type, settings });
  const call = await executeCommand(command, node, ctx);
  const base = {
    blockId: node.id,
    argv: ctx.redactArgv(call.displayArgv),
    exitCode: call.exitCode,
    stdoutSummary: summarizeStdout(ctx.redact(call.stdout)),
    stderr: ctx.redact(call.stderr),
    startedAt: stepStarted,
    endedAt: ctx.now().toISOString()
  };
  if (call.error !== null) {
    return {
      step: {
        ...base,
        status: 'failed',
        error: ctx.redact(call.error),
        io: makeStepIo(inputItems, [], 0, ctx.redact)
      },
      failed: true
    };
  }
  return {
    step: { ...base, status: 'success', io: makeStepIo(inputItems, call.items, 0, ctx.redact) },
    items: call.items,
    failed: false
  };
}

/**
 * Execute a single built command and normalize its result. Recognizes the CLIs'
 * `{ ok: false, error }` failure envelope and non-zero exits (surfaced via the
 * returned `error`), warns on empty/unrecognized payloads, and otherwise returns
 * normalized items. `parseJson` may throw on non-JSON stdout; the single-call
 * path lets that propagate (preserving the operation-classed step-error log),
 * while the fan-out path catches it per item.
 */
async function executeCommand(
  command: BuiltCommand,
  node: FlowNodeModel,
  ctx: NodeRunContext
): Promise<CliCallResult> {
  const result = await ctx.executor(command);
  const base = {
    displayArgv: command.displayArgv,
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr
  };

  // CLIs report logical failures via a `{ ok: false, error }` JSON envelope on
  // stdout (often with empty stderr), and usually a non-zero exit. Treat either
  // signal as a failure and surface the envelope's human message instead of a
  // bare "Command exited with N".
  const envelopeError = parseEnvelopeError(result.stdout);
  if (result.exitCode !== 0 || envelopeError) {
    const message = envelopeError ?? (result.stderr.trim() || `Command exited with ${result.exitCode}`);
    return { ...base, items: [], error: message };
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
  return { ...base, items, error: null };
}

/**
 * Run an enrichment node once per distinct upstream item, binding its blank
 * input field from each item. Continue-on-error within the fan-out: items that
 * succeed are kept and forwarded; the node only fails (blocking downstream) when
 * every call fails. Calls run sequentially — the per-call await is the inter-call
 * spacing that keeps the app from out-running the CLIs' own rate limiting
 * (security invariant 3). Results are aggregated into ONE RunStep so the
 * one-step-per-node contract the UI/SSE rely on holds.
 */
async function runFanOutCliNode(
  node: FlowNodeModel,
  inputItems: SocialItem[],
  blankKeys: string[],
  stepStarted: string,
  ctx: NodeRunContext
): Promise<{ step: RunStep; items?: SocialItem[]; failed: boolean }> {
  // Resolve each upstream item to per-item settings, skipping items that can't
  // drive this block (e.g. wrong platform) and deduping by the bound value so the
  // same id is never fetched twice.
  const seen = new Set<string>();
  const eligible: Record<string, unknown>[] = [];
  let incompatibleSkipped = 0;
  let dedupSkipped = 0;
  for (const item of inputItems) {
    const resolved = resolveInputBoundSettingsForItem(node.type, node.settings, item);
    if (resolved === null) {
      incompatibleSkipped += 1;
      continue;
    }
    const key = blankKeys.map((fieldKey) => String(resolved[fieldKey])).join('\u0000');
    if (seen.has(key)) {
      dedupSkipped += 1;
      continue;
    }
    seen.add(key);
    eligible.push(resolved);
  }

  // Skip policy: by default incompatible items are dropped (counted, never
  // silent). With `__bindPolicy: 'fail'` the whole node fails if ANY upstream
  // item cannot drive it, so a misconfigured wire surfaces loudly instead of
  // quietly enriching a subset.
  if (bindPolicy(node.settings) === 'fail' && incompatibleSkipped > 0) {
    const error = ctx.redact(`${incompatibleSkipped} upstream item(s) are incompatible with this block`);
    return {
      step: makeStep(node.id, 'failed', ctx.now, {
        startedAt: stepStarted,
        error,
        io: makeStepIo(inputItems, [], incompatibleSkipped + dedupSkipped, ctx.redact)
      }),
      failed: true
    };
  }

  if (eligible.length === 0) {
    const error = ctx.redact(`No upstream item supplied a value for ${blankKeys.join(', ')}`);
    return {
      step: makeStep(node.id, 'failed', ctx.now, {
        startedAt: stepStarted,
        error,
        io: makeStepIo(inputItems, [], incompatibleSkipped + dedupSkipped, ctx.redact)
      }),
      failed: true
    };
  }

  const truncated = eligible.length > MAX_FANOUT_CALLS;
  const skipped = truncated ? eligible.length - MAX_FANOUT_CALLS : 0;
  const toRun = truncated ? eligible.slice(0, MAX_FANOUT_CALLS) : eligible;
  if (truncated) {
    ctx.logger?.warn('cli.fanoutTruncated', {
      flowId: ctx.flowId,
      blockId: node.id,
      total: eligible.length,
      cap: MAX_FANOUT_CALLS
    });
  }

  const calls: CliCallResult[] = [];
  for (const settings of toRun) {
    const command = buildBlockCommand({ blockId: node.id, blockType: node.type, settings });
    try {
      calls.push(await executeCommand(command, node, ctx));
    } catch (error) {
      calls.push({
        items: [],
        displayArgv: command.displayArgv,
        exitCode: 1,
        stdout: '',
        stderr: '',
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  const succeeded = calls.filter((call) => call.error === null);
  const failures = calls.filter((call) => call.error !== null);
  const aggregated = succeeded.flatMap((call) => call.items);
  // Bound peak memory: even with the call-count cap, each call can return a large
  // normalized array, so the aggregate could OOM. Truncate to a hard item ceiling
  // and count the dropped items as skipped (surfaced, never silently lost).
  const outputTruncated = aggregated.length > MAX_NODE_OUTPUT_ITEMS;
  const items = outputTruncated ? aggregated.slice(0, MAX_NODE_OUTPUT_ITEMS) : aggregated;
  const outputDropped = outputTruncated ? aggregated.length - MAX_NODE_OUTPUT_ITEMS : 0;
  if (outputTruncated) {
    ctx.logger?.warn('cli.fanoutOutputTruncated', {
      flowId: ctx.flowId,
      blockId: node.id,
      total: aggregated.length,
      cap: MAX_NODE_OUTPUT_ITEMS
    });
  }
  const allFailed = succeeded.length === 0;
  // Every input item that did not contribute to output: wrong-platform/no-value
  // skips, dedup collisions, fan-out-cap truncation, per-call failures, and items
  // dropped by the output ceiling.
  const totalSkipped = incompatibleSkipped + dedupSkipped + skipped + failures.length + outputDropped;
  const io = makeStepIo(inputItems, items, totalSkipped, ctx.redact);

  const summaryParts = [`fan-out ${calls.length} item(s) → ${succeeded.length} enriched`];
  if (failures.length > 0) {
    summaryParts.push(`${failures.length} failed`);
  }
  if (truncated) {
    summaryParts.push(`capped at ${MAX_FANOUT_CALLS} (${skipped} skipped)`);
  }
  if (outputTruncated) {
    summaryParts.push(`output capped at ${MAX_NODE_OUTPUT_ITEMS} (${outputDropped} dropped)`);
  }

  const base = {
    blockId: node.id,
    argv: ctx.redactArgv(calls[0]?.displayArgv ?? []),
    exitCode: allFailed ? failures.at(-1)?.exitCode ?? 1 : 0,
    stdoutSummary: summarizeStdout(summaryParts.join(', ')),
    stderr: summarizeStdout(ctx.redact(failures.map((call) => call.error ?? '').filter(Boolean).join('; '))),
    startedAt: stepStarted,
    endedAt: ctx.now().toISOString()
  };

  if (allFailed) {
    const error = ctx.redact(failures[0]?.error ?? 'All fan-out calls failed');
    return { step: { ...base, status: 'failed', error, io }, failed: true };
  }
  return { step: { ...base, status: 'success', io }, items, failed: false };
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

/**
 * Run the terminal webhook sink: POST a `{ flowName, runId, count, items }`
 * envelope to the node's HTTPS URL. The bearer token (when configured) is read
 * from the run's secret map by the node's `authTokenEnvVar` name — so it is both
 * sent in the Authorization header AND scrubbed from every persisted string. The
 * step records only `['POST', maskedUrl]` and a `POST <origin> → <status>`
 * summary; non-2xx / network / timeout marks the step failed. Terminal, so it
 * blocks nothing downstream, but a `failFast` flow stops on it (the caller owns
 * that, mirroring CLI-node handling).
 */
async function runWebhookNode(
  node: FlowNodeModel,
  inputItems: SocialItem[],
  stepStarted: string,
  ctx: NodeRunContext
): Promise<{ step: RunStep; failed: boolean }> {
  const url = typeof node.settings.url === 'string' ? node.settings.url : '';
  const envVar = typeof node.settings.authTokenEnvVar === 'string' ? node.settings.authTokenEnvVar.trim() : '';
  const token = envVar ? ctx.secrets[envVar] ?? null : null;
  const body = {
    flowName: ctx.flowName,
    runId: ctx.runId,
    count: inputItems.length,
    items: inputItems
  };
  const result = await ctx.sendWebhook({ url, token, body });
  const base = {
    blockId: node.id,
    argv: ctx.redactArgv(['POST', maskWebhookUrl(url)]),
    exitCode: null,
    stdoutSummary: summarizeStdout(ctx.redact(result.summary)),
    stderr: result.error ? ctx.redact(result.error) : '',
    startedAt: stepStarted,
    endedAt: ctx.now().toISOString(),
    // Terminal sink: it "passes through" its input to the remote endpoint, so the
    // I/O preview shows N in / N delivered (mirrors how export nodes report).
    io: makeStepIo(inputItems, inputItems, 0, ctx.redact)
  };
  if (!result.ok) {
    return {
      step: { ...base, status: 'failed', error: ctx.redact(result.error ?? 'Webhook delivery failed') },
      failed: true
    };
  }
  return { step: { ...base, status: 'success', error: null }, failed: false };
}

/** Coarse operation class for a node, used to label step-failure logs. */
function operationOf(node: FlowNodeModel): string {
  if (isCliNode(node)) {
    return 'cli';
  }
  if (isWebhookNode(node)) {
    return 'webhook';
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

/**
 * Per-node I/O summary for a step: input/output/skipped counts plus a redacted,
 * reconstruction-capable sample of the produced items. Shared by every node path
 * so the preview and the cached-upstream feed read one consistent shape.
 */
function makeStepIo(
  inputItems: SocialItem[],
  outputItems: SocialItem[],
  skippedCount: number,
  redact: (value: string) => string
): RunStepIo {
  return {
    inputCount: inputItems.length,
    outputCount: outputItems.length,
    skippedCount,
    normalizedFields: collectFieldKeys(outputItems),
    sampleItems: toStepSample(outputItems, redact)
  };
}

/**
 * Project items into the redacted, capped RunStepSampleItem shape. Mirrors
 * toSampleRows' redaction invariant (security invariant 2) and caps long text, but
 * keeps engagement/community/createdAt so a cached-upstream run can reconstruct a
 * usable SocialItem.
 */
function toStepSample(
  items: SocialItem[],
  redact: (value: string) => string,
  max = MAX_STEP_SAMPLE_ITEMS
): RunStepSampleItem[] {
  return items.slice(0, max).map((item) => ({
    platform: item.platform,
    sourceBlockId: item.sourceBlockId,
    id: item.id,
    url: redactNullable(item.url, redact),
    author: redactNullable(item.author, redact),
    community: redactNullable(item.community, redact),
    title: redactNullable(item.title, redact),
    text: redact(item.text).slice(0, MAX_SAMPLE_TEXT_CHARS),
    createdAt: item.createdAt,
    engagement: item.engagement
  }));
}

/**
 * Distinct normalized field names present (non-null/non-empty) across items.
 * Derived from the items, never invented — absent SocialItem fields stay absent.
 */
function collectFieldKeys(items: SocialItem[]): string[] {
  const present = new Set<string>();
  for (const item of items) {
    if (item.id) present.add('id');
    if (item.url !== null) present.add('url');
    if (item.author !== null) present.add('author');
    if (item.community !== null) present.add('community');
    if (item.title !== null) present.add('title');
    if (item.body !== null) present.add('body');
    if (item.text !== '') present.add('text');
    if (item.createdAt) present.add('createdAt');
    if (item.media.length > 0) present.add('media');
    if (item.links.length > 0) present.add('links');
    for (const [key, value] of Object.entries(item.engagement)) {
      if (value !== null && value !== undefined) {
        present.add(key);
      }
    }
  }
  return [...present];
}

/**
 * Reconstruct a usable SocialItem from a persisted sample item so a
 * cached-upstream single-node run can feed a downstream block. Fields dropped by
 * the sample (raw/media/links/body) come back empty, matching the SocialItem contract.
 */
function sampleItemToSocialItem(sample: RunStepSampleItem): SocialItem {
  return {
    platform: sample.platform,
    sourceBlockId: sample.sourceBlockId,
    id: sample.id,
    url: sample.url,
    author: sample.author,
    community: sample.community,
    title: sample.title,
    body: null,
    text: sample.text,
    createdAt: sample.createdAt,
    engagement: sample.engagement,
    media: [],
    links: [],
    raw: {}
  };
}

/**
 * Project already-redacted sample items into the run-level RunSampleRow preview
 * shape. No re-redaction — the items were redacted when captured by toStepSample.
 */
function stepSampleToRows(items: RunStepSampleItem[]): RunSampleRow[] {
  return items.map((item) => ({
    platform: item.platform,
    id: item.id,
    title: item.title ?? (item.text || null),
    author: item.author,
    score: item.engagement.score ?? item.engagement.likes ?? null,
    created: item.createdAt || null,
    url: item.url
  }));
}

/**
 * Per-node binding skip policy. Default 'skip' (drop incompatible items, counted);
 * 'fail' makes the node fail if any upstream item cannot drive it. Stored in
 * node.settings under a non-field key so it never reaches argv or field validation.
 */
function bindPolicy(settings: Record<string, unknown>): 'skip' | 'fail' {
  return settings.__bindPolicy === 'fail' ? 'fail' : 'skip';
}

function isCliNode(node: FlowNodeModel): boolean {
  return node.type.startsWith('reddit.') || node.type.startsWith('twitter.');
}

function isWebhookNode(node: FlowNodeModel): boolean {
  return node.type === 'output.webhook';
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
  // Defense in depth: validateFlow rejects cycles before any caller reaches here,
  // but a bypass would otherwise silently DROP cyclic nodes from the order — they
  // would never execute, with no error. Fail loudly instead of producing a result
  // that quietly ran only part of the flow.
  if (ordered.length !== flow.nodes.length) {
    throw new Error('Flow graph contains a cycle; cannot determine execution order');
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
