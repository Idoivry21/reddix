import { getBlockSpec } from './commandBuilders';
import type { PortSpec } from './types';

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
  const nodesById = new Map(flow.nodes.map((node) => [node.id, node]));

  for (const node of flow.nodes) {
    const spec = getBlockSpec(node.type);
    for (const field of spec.fields) {
      if (field.required && isBlank(node.settings[field.key])) {
        errors.push({ nodeId: node.id, message: `${field.label} is required` });
      }
    }
  }

  for (const edge of flow.edges) {
    const source = nodesById.get(edge.source);
    const target = nodesById.get(edge.target);
    if (!source || !target) {
      errors.push({ nodeId: edge.id, message: 'Edge references a missing node' });
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

  if (hasCycle(flow)) {
    errors.push({ nodeId: 'flow', message: 'Graph contains a cycle' });
  }

  for (const outputNode of flow.nodes.filter((node) => getBlockSpec(node.type).category === 'Output')) {
    if (!isReachableFromSource(outputNode.id, flow, nodesById)) {
      errors.push({ nodeId: outputNode.id, message: 'Output block is not reachable from a source' });
    }
  }

  return { valid: errors.length === 0, errors };
}

function findPort(ports: PortSpec[], portId: string): PortSpec | undefined {
  return ports.find((port) => port.id === portId);
}

function isBlank(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === 'string' && value.trim() === '');
}

function hasCycle(flow: FlowModel): boolean {
  const adjacency = new Map<string, string[]>();
  for (const node of flow.nodes) {
    adjacency.set(node.id, []);
  }
  for (const edge of flow.edges) {
    adjacency.get(edge.source)?.push(edge.target);
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();

  const visit = (nodeId: string): boolean => {
    if (visiting.has(nodeId)) {
      return true;
    }
    if (visited.has(nodeId)) {
      return false;
    }
    visiting.add(nodeId);
    for (const next of adjacency.get(nodeId) ?? []) {
      if (visit(next)) {
        return true;
      }
    }
    visiting.delete(nodeId);
    visited.add(nodeId);
    return false;
  };

  return flow.nodes.some((node) => visit(node.id));
}

function isReachableFromSource(
  targetId: string,
  flow: FlowModel,
  nodesById: Map<string, FlowNodeModel>
): boolean {
  const reverse = new Map<string, string[]>();
  for (const node of flow.nodes) {
    reverse.set(node.id, []);
  }
  for (const edge of flow.edges) {
    reverse.get(edge.target)?.push(edge.source);
  }

  const queue = [...(reverse.get(targetId) ?? [])];
  const visited = new Set<string>();
  while (queue.length > 0) {
    const nodeId = queue.shift()!;
    if (visited.has(nodeId)) {
      continue;
    }
    visited.add(nodeId);
    const node = nodesById.get(nodeId);
    if (node && getBlockSpec(node.type).category === 'Sources') {
      return true;
    }
    queue.push(...(reverse.get(nodeId) ?? []));
  }
  return false;
}

