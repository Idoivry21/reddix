import type { FlowEdgeModel, FlowModel, FlowNodeModel } from './shared/graph';
import type { PersistedFlow } from './shared/types';
import type { WorkbenchEdge, WorkbenchNode } from './flowTypes';

/**
 * UI-side flow metadata. Uses `flowId` (not `id`) to disambiguate from node/edge
 * ids at call sites; it is translated to the persisted/REST contract name `id`
 * in {@link toFlowRequestBody}. This rename is a deliberate boundary, not drift —
 * `id` is the storage shape ({@link PersistedFlow.id}) and cannot change without a
 * data migration.
 */
export interface FlowMeta {
  flowId: string;
  name: string;
  failFast: boolean;
}

export type FlowRequestFlow = Pick<
  PersistedFlow,
  'id' | 'name' | 'failFast' | 'nodes' | 'edges' | 'nodePositions' | 'blockSettings' | 'schedule'
>;

export interface FlowRequestBody {
  flow: FlowRequestFlow;
}

export function toFlowModel(nodes: WorkbenchNode[], edges: WorkbenchEdge[]): FlowModel {
  return {
    nodes: nodes.map(toFlowNode),
    edges: edges.map(toFlowEdge)
  };
}

export function toFlowRequestBody(
  nodes: WorkbenchNode[],
  edges: WorkbenchEdge[],
  meta: FlowMeta,
  schedule: PersistedFlow['schedule'] = { enabled: false }
): FlowRequestBody {
  const model = toFlowModel(nodes, edges);
  return {
    flow: {
      id: meta.flowId,
      name: meta.name,
      failFast: meta.failFast,
      nodes: model.nodes,
      edges: model.edges,
      nodePositions: Object.fromEntries(nodes.map((node) => [node.id, { x: node.x, y: node.y }])),
      blockSettings: Object.fromEntries(nodes.map((node) => [node.id, { ...node.settings }])),
      schedule
    }
  };
}

// Boundary: the UI node calls its block kind `blockType`; the shared/persisted
// FlowNodeModel calls it `type`. The two names are intentional (the persisted
// `type` is the on-disk/zod contract) — this is the single translation point in.
// rehydrateNodes (useWorkbenchState) is the reverse translation out.
function toFlowNode(node: WorkbenchNode): FlowNodeModel {
  return {
    id: node.id,
    type: node.blockType,
    settings: { ...node.settings }
  };
}

function toFlowEdge(edge: WorkbenchEdge): FlowEdgeModel {
  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    sourcePortId: edge.sourcePortId ?? '',
    targetPortId: edge.targetPortId ?? ''
  };
}
