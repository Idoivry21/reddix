import { canConnect } from './shared/graph';
import { getBlockSpec } from './shared/commandBuilders';
import type { NodeSize, WorkbenchEdge, WorkbenchNode } from './flowTypes';
import type { BlockSpec, PortSpec } from './shared/types';

export const DEFAULT_NODE_SIZE: NodeSize = { w: 232, h: 120 };

/**
 * Canvas zoom, drop-placement, and fit-framing tuning. Centralized so behavior
 * can be adjusted in one place instead of via inline literals scattered across
 * the canvas component and the workbench hook.
 */
export const CANVAS_GEOMETRY = {
  /** Zoom multiplier per ⌘/Ctrl-scroll wheel tick (in = zoom toward cursor). */
  wheelZoom: { in: 1.08, out: 0.926 },
  /** Zoom multiplier applied by the toolbar +/- buttons. */
  toolbarZoom: { in: 1.14, out: 0.88 },
  /** Offset subtracted from the drop point so a dropped block lands under the cursor. */
  dropOffset: { x: 110, y: 40 },
  /** Fit-to-view framing: outer padding, reserved header band, top nudge, zoom clamps. */
  fit: { padding: 80, headerReserve: 60, topNudge: 10, minZoom: 0.35, maxZoom: 1.1 },
  /** Delay (ms) before re-framing after mount / after opening another flow. */
  fitDelayMs: { mount: 80, openFlow: 60 }
} as const;

/** Even vertical spacing for the i-th of n ports along a node edge. */
export function portFrac(index: number, count: number): number {
  return (index + 1) / (count + 1);
}

export interface PortPoint {
  x: number;
  y: number;
  id: string;
  index: number;
}

export interface NodePortGeometry {
  ins: PortPoint[];
  outs: PortPoint[];
  w: number;
  h: number;
}

/** Absolute canvas coordinates of every input/output port for a node. */
export function nodePorts(node: WorkbenchNode, spec: BlockSpec, size?: NodeSize): NodePortGeometry {
  const w = size?.w ?? DEFAULT_NODE_SIZE.w;
  const h = size?.h ?? DEFAULT_NODE_SIZE.h;
  const ins = portPoints(spec.ports.input, node.x, node.y, h);
  const outs = portPoints(spec.ports.output, node.x + w, node.y, h);
  return { ins, outs, w, h };
}

function portPoints(ports: PortSpec[], x: number, top: number, h: number): PortPoint[] {
  return ports.map((port, index) => ({
    x,
    y: top + h * portFrac(index, ports.length),
    id: port.id,
    index
  }));
}

/** Horizontal control-point reach for the edge bezier; shared by the rendered
 * path ({@link edgePath}) and the distance sampler so both describe one curve. */
function edgeControlReach(sx: number, tx: number): number {
  return Math.max(48, Math.abs(tx - sx) * 0.5);
}

/** Smooth bezier SVG path string between an output and an input port. */
export function edgePath(sx: number, sy: number, tx: number, ty: number): string {
  const dx = edgeControlReach(sx, tx);
  return `M ${sx} ${sy} C ${sx + dx} ${sy} ${tx - dx} ${ty} ${tx} ${ty}`;
}

/** Max center-to-curve distance (canvas px) for a node to splice into an edge. */
export const SPLICE_DISTANCE_THRESHOLD = 28;

// Samples taken along the cubic bezier when measuring point-to-edge distance.
// 20 segments tracks the curve's bow closely enough for a 28px hit test while
// staying cheap to run on every pointer-move.
const EDGE_SAMPLE_COUNT = 20;

/**
 * Minimum distance from `point` to the rendered edge bezier between an output
 * port (sx, sy) and an input port (tx, ty). Samples the same control points as
 * {@link edgePath} so the hit test matches the drawn wire, including its bow.
 */
export function distanceToEdge(
  point: { x: number; y: number },
  sx: number,
  sy: number,
  tx: number,
  ty: number
): number {
  const dx = edgeControlReach(sx, tx);
  const c1x = sx + dx;
  const c1y = sy;
  const c2x = tx - dx;
  const c2y = ty;
  let min = Infinity;
  for (let i = 0; i <= EDGE_SAMPLE_COUNT; i += 1) {
    const t = i / EDGE_SAMPLE_COUNT;
    const mt = 1 - t;
    const a = mt * mt * mt;
    const b = 3 * mt * mt * t;
    const c = 3 * mt * t * t;
    const d = t * t * t;
    const bx = a * sx + b * c1x + c * c2x + d * tx;
    const by = a * sy + b * c1y + c * c2y + d * ty;
    const dist = Math.hypot(point.x - bx, point.y - by);
    if (dist < min) {
      min = dist;
    }
  }
  return min;
}

/** The dragged node's resolved input/output port ids for a splice. */
export interface SplicePortPair {
  inPortId: string;
  outPortId: string;
}

/**
 * Resolve which of the dragged node's ports a splice would use: the first input
 * port that `canConnect`s from the edge source's output, and the first output
 * port whose type the edge target's input accepts. Returns null when the node
 * cannot sit in the middle (a pure Source, a pure Output, or any type mismatch).
 */
export function resolveSplicePorts(input: {
  sourceBlockType: string;
  sourcePortId: string;
  nodeBlockType: string;
  targetBlockType: string;
  targetPortId: string;
}): SplicePortPair | null {
  const spec = getBlockSpec(input.nodeBlockType);
  const inPort = spec.ports.input.find(
    (port) =>
      canConnect({
        sourceBlockType: input.sourceBlockType,
        sourcePortId: input.sourcePortId,
        targetBlockType: input.nodeBlockType,
        targetPortId: port.id
      }).valid
  );
  if (!inPort) {
    return null;
  }
  const outPort = spec.ports.output.find(
    (port) =>
      canConnect({
        sourceBlockType: input.nodeBlockType,
        sourcePortId: port.id,
        targetBlockType: input.targetBlockType,
        targetPortId: input.targetPortId
      }).valid
  );
  if (!outPort) {
    return null;
  }
  return { inPortId: inPort.id, outPortId: outPort.id };
}

/** Lookups {@link findSpliceTarget} needs to resolve edge geometry and types. */
export interface SpliceContext {
  nodes: WorkbenchNode[];
  sizes: Record<string, NodeSize>;
  /** Override the default {@link SPLICE_DISTANCE_THRESHOLD} (mainly for tests). */
  threshold?: number;
}

/**
 * Id of the nearest edge the dragged node can splice into, or null. An edge
 * qualifies only when the node center is within the distance threshold of its
 * curve, the node is neither the edge's source nor target, and the node's ports
 * bridge source→node→target (see {@link resolveSplicePorts}). Ties break to the
 * smallest center-to-curve distance.
 */
export function findSpliceTarget(
  dragged: WorkbenchNode,
  center: { x: number; y: number },
  edges: WorkbenchEdge[],
  ctx: SpliceContext
): string | null {
  const threshold = ctx.threshold ?? SPLICE_DISTANCE_THRESHOLD;
  const nodeById = new Map(ctx.nodes.map((node) => [node.id, node]));
  let bestId: string | null = null;
  let bestDist = Infinity;
  for (const edge of edges) {
    if (edge.source === dragged.id || edge.target === dragged.id) {
      continue;
    }
    const source = nodeById.get(edge.source);
    const target = nodeById.get(edge.target);
    if (!source || !target) {
      continue;
    }
    const outPoint = nodePorts(source, getBlockSpec(source.blockType), ctx.sizes[source.id]).outs.find(
      (point) => point.id === edge.sourcePortId
    );
    const inPoint = nodePorts(target, getBlockSpec(target.blockType), ctx.sizes[target.id]).ins.find(
      (point) => point.id === edge.targetPortId
    );
    if (!outPoint || !inPoint) {
      continue;
    }
    const dist = distanceToEdge(center, outPoint.x, outPoint.y, inPoint.x, inPoint.y);
    if (dist > threshold || dist >= bestDist) {
      continue;
    }
    const ports = resolveSplicePorts({
      sourceBlockType: source.blockType,
      sourcePortId: edge.sourcePortId,
      nodeBlockType: dragged.blockType,
      targetBlockType: target.blockType,
      targetPortId: edge.targetPortId
    });
    if (!ports) {
      continue;
    }
    bestId = edge.id;
    bestDist = dist;
  }
  return bestId;
}
