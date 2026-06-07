import { getBlockSpec, validateBlockSettings } from './commandBuilders';
import type { BlockSpec } from './types';
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
  const specsByNodeId = new Map<string, BlockSpec>();

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
    for (const message of validateBlockSettings(node.type, node.settings)) {
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

  if (hasCycle(flow)) {
    errors.push({ nodeId: 'flow', message: 'Graph contains a cycle' });
  }

  for (const outputNode of flow.nodes.filter((node) => specsByNodeId.get(node.id)?.category === 'Output')) {
    if (!isReachableFromSource(outputNode.id, flow, nodesById, specsByNodeId)) {
      errors.push({ nodeId: outputNode.id, message: 'Output block is not reachable from a source' });
    }
  }

  return { valid: errors.length === 0, errors };
}

function findPort(ports: PortSpec[], portId: string): PortSpec | undefined {
  return ports.find((port) => port.id === portId);
}

function hasCycle(flow: FlowModel): boolean {
  const adjacency = new Map<string, string[]>();
  for (const node of flow.nodes) {
    adjacency.set(node.id, []);
  }
  for (const edge of flow.edges) {
    adjacency.get(edge.source)?.push(edge.target);
  }

  const visited = new Set<string>();
  const visiting = new Set<string>();

  for (const node of flow.nodes) {
    const startId = node.id;
    if (visited.has(startId)) {
      continue;
    }
    const stack: Array<{ nodeId: string; nextIndex: number }> = [{ nodeId: startId, nextIndex: 0 }];
    visiting.add(startId);
    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      const nextNodes = adjacency.get(frame.nodeId) ?? [];
      if (frame.nextIndex >= nextNodes.length) {
        visiting.delete(frame.nodeId);
        visited.add(frame.nodeId);
        stack.pop();
        continue;
      }
      const next = nextNodes[frame.nextIndex];
      frame.nextIndex += 1;
      if (visiting.has(next)) {
        return true;
      }
      if (!visited.has(next)) {
        visiting.add(next);
        stack.push({ nodeId: next, nextIndex: 0 });
      }
    }
  }

  return false;
}

function isReachableFromSource(
  targetId: string,
  flow: FlowModel,
  nodesById: Map<string, FlowNodeModel>,
  specsByNodeId: Map<string, BlockSpec>
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
    if (node && specsByNodeId.get(node.id)?.category === 'Sources') {
      return true;
    }
    queue.push(...(reverse.get(nodeId) ?? []));
  }
  return false;
}
