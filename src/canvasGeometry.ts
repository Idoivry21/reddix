import type { NodeSize, WorkbenchNode } from './flowTypes';
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

/** Smooth bezier SVG path string between an output and an input port. */
export function edgePath(sx: number, sy: number, tx: number, ty: number): string {
  const dx = Math.max(48, Math.abs(tx - sx) * 0.5);
  return `M ${sx} ${sy} C ${sx + dx} ${sy} ${tx - dx} ${ty} ${tx} ${ty}`;
}
