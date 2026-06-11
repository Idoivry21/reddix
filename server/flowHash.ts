import { createHash } from 'node:crypto';
import type { FlowDefinition } from './types';

/**
 * Stable JSON projection: object keys sorted recursively so two semantically
 * identical structures serialize identically regardless of key insertion order.
 */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonical);
  }
  if (value && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    return Object.keys(source)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = canonical(source[key]);
        return acc;
      }, {});
  }
  return value;
}

/**
 * Deterministic hash of a flow's executable structure: each node's id/type/settings
 * and each edge's endpoints + ports. Canvas-only data (node positions) lives outside
 * {@link FlowDefinition}, so moving nodes never changes the hash; editing a query or
 * rewiring an edge does. Edge ids are intentionally excluded — connectivity, not the
 * arbitrary edge id, is what matters — so re-drawing an identical edge does not force
 * a false "flow changed" rejection.
 *
 * Stamped onto every full {@link RunRecord}; a later `cached-upstream` single-node run
 * compares it against the current flow and refuses to feed cached samples on mismatch,
 * closing the hole where an edited upstream query silently fed stale cached data.
 */
export function computeFlowGraphHash(flow: FlowDefinition): string {
  const nodes = [...flow.nodes]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((node) => ({ id: node.id, type: node.type, settings: canonical(node.settings) }));
  const edges = [...flow.edges]
    .map((edge) => ({
      source: edge.source,
      target: edge.target,
      sourcePortId: edge.sourcePortId,
      targetPortId: edge.targetPortId
    }))
    .sort((a, b) =>
      `${a.source}>${a.target}:${a.sourcePortId}>${a.targetPortId}`.localeCompare(
        `${b.source}>${b.target}:${b.sourcePortId}>${b.targetPortId}`
      )
    );
  return createHash('sha256').update(JSON.stringify({ nodes, edges })).digest('hex');
}
