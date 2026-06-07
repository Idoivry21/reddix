import { nanoid } from 'nanoid';
import { buildBlockCommand } from '../src/shared/commandBuilders';
import { buildTimestampedExportPath, serializeCsv, serializeJson, serializeMarkdown } from '../src/shared/exporters';
import { serializeHtml } from '../src/shared/htmlReport';
import type { FlowEdgeModel, FlowNodeModel } from '../src/shared/graph';
import { validateFlow } from '../src/shared/graph';
import { normalizeRedditPayload, normalizeTwitterPayload } from '../src/shared/normalizers';
import { redactSecrets } from '../src/shared/redaction';
import type { SecretMap } from '../src/shared/redaction';
import { applyEngagementFilter, applyFilterText, applyLimit, applyMerge, applySort } from '../src/shared/transforms';
import type { RunSampleRow, SocialItem } from '../src/shared/types';
import type { CliExecutor, FlowDefinition, RunRecord, RunStep } from './types';

/** Cap the rows carried on a run so payloads/SSE/persisted records stay bounded. */
const MAX_SAMPLE_ROWS = 50;

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
}

export async function runFlow(options: RunFlowOptions): Promise<RunRecord> {
  const now = options.now ?? (() => new Date());
  const secrets = options.secrets ?? {};
  const redact = (value: string): string => redactSecrets(value, secrets);
  const redactArgv = (value: string[]): string[] => redactSecrets(value, secrets);
  const startedAt = now().toISOString();
  const validation = validateFlow(options.flow);
  if (!validation.valid) {
    return {
      schemaVersion: 1,
      id: nanoid(),
      flowId: options.flow.id,
      status: 'failed',
      startedAt,
      endedAt: now().toISOString(),
      steps: [],
      outputFiles: [],
      error: validation.errors.map((error) => error.message).join('; '),
      sample: []
    };
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

  for (const node of nodes) {
    const dependencyEdges = edgesByTarget.get(node.id) ?? [];
    const dependencyBlocked =
      blocked.has(node.id) || dependencyEdges.some((edge) => blocked.has(edge.source));
    if (dependencyBlocked) {
      const step = makeStep(node.id, 'skipped', now, { error: 'Skipped because an upstream step failed' });
      steps.push(step);
      options.emit?.({ type: 'step', step });
      markDownstreamBlocked(node.id, edgesBySource, blocked);
      continue;
    }

    const stepStarted = now().toISOString();
    try {
      if (isCliNode(node)) {
        const command = buildBlockCommand({
          blockId: node.id,
          blockType: node.type,
          settings: node.settings
        });
        const result = await options.executor(command);
        // CLIs report logical failures via a `{ ok: false, error }` JSON
        // envelope on stdout (often with empty stderr), and usually a non-zero
        // exit. Treat either signal as a failure and surface the envelope's
        // human message instead of a bare "Command exited with N".
        const envelopeError = parseEnvelopeError(result.stdout);
        if (result.exitCode !== 0 || envelopeError) {
          failed = true;
          const message =
            envelopeError ?? (result.stderr.trim() || `Command exited with ${result.exitCode}`);
          const step: RunStep = {
            blockId: node.id,
            status: 'failed',
            argv: redactArgv(command.displayArgv),
            exitCode: result.exitCode,
            stdoutSummary: summarizeStdout(redact(result.stdout)),
            stderr: redact(result.stderr),
            startedAt: stepStarted,
            endedAt: now().toISOString(),
            error: redact(message)
          };
          steps.push(step);
          options.emit?.({ type: 'step', step });
          markDownstreamBlocked(node.id, edgesBySource, blocked);
          if (options.flow.failFast) {
            break;
          }
          continue;
        }

        const payload = parseJson(result.stdout);
        data.set(
          node.id,
          command.provider === 'reddit'
            ? normalizeRedditPayload(payload, node.id)
            : normalizeTwitterPayload(payload, node.id)
        );
        const step: RunStep = {
          blockId: node.id,
          status: 'success',
          argv: redactArgv(command.displayArgv),
          exitCode: result.exitCode,
          stdoutSummary: summarizeStdout(redact(result.stdout)),
          stderr: redact(result.stderr),
          startedAt: stepStarted,
          endedAt: now().toISOString()
        };
        steps.push(step);
        options.emit?.({ type: 'step', step });
        continue;
      }

      const inputItems = dependencyEdges.flatMap((edge) => data.get(edge.source) ?? []);
      if (node.type === 'transform.limit') {
        data.set(node.id, applyLimit(inputItems, node.settings));
      } else if (node.type === 'transform.filterText') {
        data.set(node.id, applyFilterText(inputItems, node.settings));
      } else if (node.type === 'transform.engagementFilter') {
        data.set(node.id, applyEngagementFilter(inputItems, node.settings));
      } else if (node.type === 'transform.sortLocal') {
        data.set(node.id, applySort(inputItems, node.settings));
      } else if (node.type === 'transform.mergeStreams') {
        data.set(node.id, applyMerge(inputItems));
      } else if (node.type.startsWith('output.')) {
        const artifact = await writeOutput(node, inputItems, options.writeArtifact, now(), options.flow.name);
        outputFiles.push(artifact);
        sample = toSampleRows(inputItems, redact);
      } else {
        data.set(node.id, inputItems);
      }

      const step = makeStep(node.id, 'success', now, { startedAt: stepStarted });
      steps.push(step);
      options.emit?.({ type: 'step', step });
    } catch (error) {
      failed = true;
      const step = makeStep(node.id, 'failed', now, {
        startedAt: stepStarted,
        error: redact(error instanceof Error ? error.message : String(error))
      });
      steps.push(step);
      options.emit?.({ type: 'step', step });
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

  return {
    schemaVersion: 1,
    id: nanoid(),
    flowId: options.flow.id,
    status: failed ? 'failed' : 'success',
    startedAt,
    endedAt: now().toISOString(),
    steps,
    outputFiles,
    error: failed ? 'One or more steps failed' : null,
    sample
  };
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
    kind: item.platform,
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

function summarizeStdout(stdout: string): string {
  return stdout.length > 240 ? `${stdout.slice(0, 240)}...` : stdout;
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
