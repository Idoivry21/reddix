import { nanoid } from 'nanoid';
import { buildBlockCommand } from '../src/shared/commandBuilders';
import { buildTimestampedExportPath, serializeCsv, serializeJson, serializeMarkdown } from '../src/shared/exporters';
import type { FlowEdgeModel, FlowNodeModel } from '../src/shared/graph';
import { validateFlow } from '../src/shared/graph';
import { normalizeRedditPayload, normalizeTwitterPayload } from '../src/shared/normalizers';
import { applyEngagementFilter, applyFilterText, applyLimit } from '../src/shared/transforms';
import type { SocialItem } from '../src/shared/types';
import type { CliExecutor, FlowDefinition, RunRecord, RunStep } from './types';

interface RunFlowOptions {
  flow: FlowDefinition;
  executor: CliExecutor;
  writeArtifact: (filePath: string, contents: string) => Promise<{ path: string; bytes: number }>;
  now?: () => Date;
  emit?: (event: { type: string; step?: RunStep }) => void;
}

export async function runFlow(options: RunFlowOptions): Promise<RunRecord> {
  const now = options.now ?? (() => new Date());
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
      error: validation.errors.map((error) => error.message).join('; ')
    };
  }

  const nodes = topologicalNodes(options.flow);
  const edgesByTarget = groupEdges(options.flow.edges, 'target');
  const edgesBySource = groupEdges(options.flow.edges, 'source');
  const data = new Map<string, SocialItem[]>();
  const blocked = new Set<string>();
  const steps: RunStep[] = [];
  const outputFiles: Array<{ path: string; bytes: number }> = [];
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
        if (result.exitCode !== 0) {
          failed = true;
          const step: RunStep = {
            blockId: node.id,
            status: 'failed',
            argv: command.displayArgv,
            exitCode: result.exitCode,
            stdoutSummary: summarizeStdout(result.stdout),
            stderr: result.stderr,
            startedAt: stepStarted,
            endedAt: now().toISOString(),
            error: result.stderr || `Command exited with ${result.exitCode}`
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
          argv: command.displayArgv,
          exitCode: result.exitCode,
          stdoutSummary: summarizeStdout(result.stdout),
          stderr: result.stderr,
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
      } else if (node.type.startsWith('output.')) {
        const artifact = await writeOutput(node, inputItems, options.writeArtifact, now());
        outputFiles.push(artifact);
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
        error: error instanceof Error ? error.message : String(error)
      });
      steps.push(step);
      options.emit?.({ type: 'step', step });
      markDownstreamBlocked(node.id, edgesBySource, blocked);
      if (options.flow.failFast) {
        break;
      }
    }
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
    error: failed ? 'One or more steps failed' : null
  };
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
  while (queue.length) {
    const node = queue.shift()!;
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
    groups.set(edge[key], [...(groups.get(edge[key]) ?? []), edge]);
  }
  return groups;
}

function markDownstreamBlocked(
  nodeId: string,
  edgesBySource: Map<string, FlowEdgeModel[]>,
  blocked: Set<string>
) {
  for (const edge of edgesBySource.get(nodeId) ?? []) {
    blocked.add(edge.target);
    markDownstreamBlocked(edge.target, edgesBySource, blocked);
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

function summarizeStdout(stdout: string): string {
  return stdout.length > 240 ? `${stdout.slice(0, 240)}...` : stdout;
}

async function writeOutput(
  node: FlowNodeModel,
  items: SocialItem[],
  writeArtifact: RunFlowOptions['writeArtifact'],
  now: Date
): Promise<{ path: string; bytes: number }> {
  const rawPath = typeof node.settings.path === 'string' ? node.settings.path : 'outputs/export.json';
  const filePath = buildTimestampedExportPath(rawPath, now);
  if (node.type === 'output.exportCsv') {
    return writeArtifact(filePath, serializeCsv(items));
  }
  if (node.type === 'output.exportMarkdown') {
    return writeArtifact(filePath, serializeMarkdown(items));
  }
  return writeArtifact(filePath, serializeJson(items, node.settings.pretty !== false));
}
