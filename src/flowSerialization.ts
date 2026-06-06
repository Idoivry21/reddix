import type { Edge } from '@xyflow/react';
import type { FlowEdgeModel, FlowModel, FlowNodeModel } from './shared/graph';
import type { PersistedFlow } from './shared/types';
import type { WorkbenchNode } from './flowTypes';

export interface FlowMeta {
  flowId: string;
  name: string;
  failFast: boolean;
}

export type FlowRequestFlow = Pick<
  PersistedFlow,
  'id' | 'name' | 'failFast' | 'nodes' | 'edges' | 'nodePositions' | 'blockSettings'
>;

export interface FlowRequestBody {
  flow: FlowRequestFlow;
}

export function toFlowModel(nodes: WorkbenchNode[], edges: Edge[]): FlowModel {
  return {
    nodes: nodes.map(toFlowNode),
    edges: edges.map(toFlowEdge)
  };
}

export function toFlowRequestBody(nodes: WorkbenchNode[], edges: Edge[], meta: FlowMeta): FlowRequestBody {
  const model = toFlowModel(nodes, edges);
  return {
    flow: {
      id: meta.flowId,
      name: meta.name,
      failFast: meta.failFast,
      nodes: model.nodes,
      edges: model.edges,
      nodePositions: Object.fromEntries(nodes.map((node) => [node.id, { ...node.position }])),
      blockSettings: Object.fromEntries(nodes.map((node) => [node.id, { ...node.data.settings }]))
    }
  };
}

function toFlowNode(node: WorkbenchNode): FlowNodeModel {
  return {
    id: node.id,
    type: node.data.blockType,
    settings: { ...node.data.settings }
  };
}

function toFlowEdge(edge: Edge): FlowEdgeModel {
  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    sourcePortId: edge.sourceHandle ?? '',
    targetPortId: edge.targetHandle ?? ''
  };
}
