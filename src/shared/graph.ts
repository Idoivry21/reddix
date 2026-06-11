import { getBlockSpec, validateBlockSettings } from './commandBuilders';
import { availableInputFields, isScalarBindable } from './fieldSchema';
import { boundFieldKeys, readBindings } from './inputBindings';
import type { BlockSpec } from './types';
import type { PortSpec } from './types';
import { isBlank } from './values';

export interface FlowNodeModel {
  id: string;
  type: string;
  settings: Record<string, unknown>;
}

export interface FlowEdgeModel {
  id: string;
  source: string;
  target: string;
  sourcePortId: string;
  targetPortId: string;
}

export interface FlowModel {
  nodes: FlowNodeModel[];
  edges: FlowEdgeModel[];
}

export interface ValidationError {
  nodeId: string;
  message: string;
}

export function canConnect(input: {
  sourceBlockType: string;
  sourcePortId: string;
  targetBlockType: string;
  targetPortId: string;
}): { valid: true } | { valid: false; reason: string } {
  const sourcePort = findPort(getBlockSpec(input.sourceBlockType).ports.output, input.sourcePortId);
  const targetPort = findPort(getBlockSpec(input.targetBlockType).ports.input, input.targetPortId);

  if (!sourcePort || !targetPort) {
    return { valid: false, reason: 'Port not found' };
  }
  if (sourcePort.type === 'Any' || targetPort.type === 'Any' || sourcePort.type === targetPort.type) {
    return { valid: true };
  }
  return { valid: false, reason: `${sourcePort.type} cannot connect to ${targetPort.type}` };
}

export function validateFlow(flow: FlowModel): { valid: boolean; errors: ValidationError[] } {
  const errors: ValidationError[] = [];

  // Reject duplicate topology before anything else (finding #17): duplicate node
  // ids silently collapse Map keys (and would surface as a misleading "cycle"),
  // and duplicate edges multiply rows at run time. Report each duplicate once.
  const seenNodeIds = new Set<string>();
  const reportedNodeIds = new Set<string>();
  let hasDuplicateNodeIds = false;
  for (const node of flow.nodes) {
    if (seenNodeIds.has(node.id)) {
      hasDuplicateNodeIds = true;
      if (!reportedNodeIds.has(node.id)) {
        errors.push({ nodeId: node.id, message: 'Duplicate node id' });
        reportedNodeIds.add(node.id);
      }
    }
    seenNodeIds.add(node.id);
  }
  const seenEdgeIds = new Set<string>();
  const seenTuples = new Set<string>();
  for (const edge of flow.edges) {
    if (seenEdgeIds.has(edge.id)) {
      errors.push({ nodeId: edge.id, message: 'Duplicate edge id' });
    }
    seenEdgeIds.add(edge.id);
    const tuple = `${edge.source}\0${edge.target}\0${edge.sourcePortId}\0${edge.targetPortId}`;
    if (seenTuples.has(tuple)) {
      errors.push({ nodeId: edge.id, message: 'Duplicate connection between nodes' });
    }
    seenTuples.add(tuple);
  }

  const nodesById = new Map(flow.nodes.map((node) => [node.id, node]));
  const specsByNodeId = new Map<string, BlockSpec>();
  const hasIncomingInput = new Set(flow.edges.map((edge) => edge.target));

  for (const node of flow.nodes) {
    let spec: BlockSpec;
    try {
      spec = getBlockSpec(node.type);
    } catch (error) {
      errors.push({
        nodeId: node.id,
        message: error instanceof Error ? error.message : `Unknown block type: ${node.type}`
      });
      continue;
    }
    specsByNodeId.set(node.id, spec);
    const optionalRequiredFields = hasIncomingInput.has(node.id)
      ? boundFieldKeys(node.type, node.settings)
      : [];
    for (const message of validateBlockSettings(node.type, node.settings, {
      enforceRequired: true,
      rejectFlagLikeStrings: true,
      optionalRequiredFields
    })) {
      errors.push({ nodeId: node.id, message });
    }
  }

  for (const edge of flow.edges) {
    const source = nodesById.get(edge.source);
    const target = nodesById.get(edge.target);
    if (!source || !target) {
      errors.push({ nodeId: edge.id, message: 'Edge references a missing node' });
      continue;
    }
    if (!specsByNodeId.has(source.id) || !specsByNodeId.has(target.id)) {
      continue;
    }
    const connection = canConnect({
      sourceBlockType: source.type,
      sourcePortId: edge.sourcePortId,
      targetBlockType: target.type,
      targetPortId: edge.targetPortId
    });
    if (!connection.valid) {
      errors.push({ nodeId: edge.id, message: connection.reason });
    }
  }

  // Skip the cycle check when node ids are duplicated: hasCycle keys its Maps by
  // node id, so duplicates collapse and falsely report a cycle — the precise
  // "Duplicate node id" error above already covers that case.
  if (!hasDuplicateNodeIds && hasCycle(flow)) {
    errors.push({ nodeId: 'flow', message: 'Graph contains a cycle' });
  }

  for (const outputNode of flow.nodes.filter((node) => specsByNodeId.get(node.id)?.category === 'Output')) {
    if (!isReachableFromSource(outputNode.id, flow, nodesById, specsByNodeId)) {
      errors.push({ nodeId: outputNode.id, message: 'Output block is not reachable from a source' });
    }
  }

  // Dangling user bindings: a field mapped to an upstream key that no upstream
  // node actually provides would silently drop every item at run time, so flag
  // it as an error rather than letting it fail quietly.
  for (const node of flow.nodes) {
    const bindings = readBindings(node.settings);
    const sourceKeys = Object.values(bindings);
    if (sourceKeys.length === 0) {
      continue;
    }
    const available = new Set(
      availableInputFields(node.id, flow.nodes, flow.edges)
        .filter(isScalarBindable)
        .map((field) => field.key)
    );
    for (const [fieldKey, sourceKey] of Object.entries(bindings)) {
      if (!available.has(sourceKey)) {
        errors.push({
          nodeId: node.id,
          message: `Field "${fieldKey}" is bound to "${sourceKey}", which no upstream node provides`
        });
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

function findPort(ports: PortSpec[], portId: string): PortSpec | undefined {
  return ports.find((port) => port.id === portId);
}

/**
 * Build a node→neighbours map. `forward` (default) maps source→target; `reverse`
 * maps target→source. Every node id is seeded with an empty list so lookups never
 * return undefined for an isolated node.
 */
function buildAdjacency(flow: FlowModel, reverse: boolean): Map<string, string[]> {
  const adjacency = new Map<string, string[]>(flow.nodes.map((node) => [node.id, [] as string[]]));
  for (const edge of flow.edges) {
    const [from, to] = reverse ? [edge.target, edge.source] : [edge.source, edge.target];
    adjacency.get(from)?.push(to);
  }
  return adjacency;
}

/**
 * True if the flow's directed edges contain a cycle. Uses Kahn's topological
 * sort iteratively (no recursion, so arbitrarily deep acyclic chains are safe):
 * if fewer nodes can be peeled off than exist, the remainder forms a cycle.
 */
function hasCycle(flow: FlowModel): boolean {
  const adjacency = buildAdjacency(flow, false);
  const indegree = new Map<string, number>(flow.nodes.map((node) => [node.id, 0]));
  for (const targets of adjacency.values()) {
    for (const target of targets) {
      if (indegree.has(target)) {
        indegree.set(target, (indegree.get(target) ?? 0) + 1);
      }
    }
  }
  const queue = [...indegree].filter(([, degree]) => degree === 0).map(([id]) => id);
  let processed = 0;
  for (let index = 0; index < queue.length; index += 1) {
    processed += 1;
    for (const target of adjacency.get(queue[index]) ?? []) {
      if (!indegree.has(target)) {
        continue;
      }
      const degree = (indegree.get(target) ?? 0) - 1;
      indegree.set(target, degree);
      if (degree === 0) {
        queue.push(target);
      }
    }
  }
  return processed < flow.nodes.length;
}

function isReachableFromSource(
  targetId: string,
  flow: FlowModel,
  nodesById: Map<string, FlowNodeModel>,
  specsByNodeId: Map<string, BlockSpec>
): boolean {
  const reverse = buildAdjacency(flow, true);
  const hasIncoming = new Set(flow.edges.map((edge) => edge.target));
  const queue = [...(reverse.get(targetId) ?? [])];
  const visited = new Set<string>();
  while (queue.length > 0) {
    const nodeId = queue.shift()!;
    if (visited.has(nodeId)) {
      continue;
    }
    visited.add(nodeId);
    const node = nodesById.get(nodeId);
    const spec = node ? specsByNodeId.get(node.id) : undefined;
    if (node && spec && isReachabilityOrigin(node, spec, hasIncoming)) {
      return true;
    }
    queue.push(...(reverse.get(nodeId) ?? []));
  }
  return false;
}

function isReachabilityOrigin(
  node: FlowNodeModel,
  spec: BlockSpec,
  hasIncoming: Set<string>
): boolean {
  if (spec.category === 'Sources') {
    return true;
  }
  if (spec.category !== 'Enrichment' || hasIncoming.has(node.id)) {
    return false;
  }
  if (!spec.ports.output.some((port) => port.type === 'SocialItem[]')) {
    return false;
  }
  return spec.fields.filter((field) => field.required).every((field) => !isBlank(node.settings[field.key]));
}
