import type { NodeSize, WorkbenchNode } from './flowTypes';
import type { BlockSpec, PortSpec } from './shared/types';

export const DEFAULT_NODE_SIZE: NodeSize = { w: 232, h: 120 };

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
