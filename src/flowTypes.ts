export type NodeStatus = 'idle' | 'pending' | 'running' | 'success' | 'error';

export type RunStatusKind = 'idle' | 'running' | 'success' | 'warning' | 'error';

export interface RunStatus {
  kind: RunStatusKind;
  message: string;
}

/**
 * Flat canvas node model. The app drives a bespoke canvas (no @xyflow), so the
 * node carries its own position and block payload directly instead of nesting it
 * under a `data` field.
 */
export interface WorkbenchNode {
  id: string;
  blockType: string;
  label: string;
  x: number;
  y: number;
  settings: Record<string, unknown>;
  status: NodeStatus;
}

/**
 * Canvas edge. Port ids match the shared `FlowEdgeModel`, so serialization to
 * the backend is a near pass-through.
 */
export interface WorkbenchEdge {
  id: string;
  source: string;
  target: string;
  sourcePortId: string;
  targetPortId: string;
}

/** Viewport transform: pan offset (x, y) and zoom scale (k). */
export interface CanvasView {
  x: number;
  y: number;
  k: number;
}

export interface NodeSize {
  w: number;
  h: number;
}

export const DEFAULT_FLOW_ID = 'primary-flow';
export const DEFAULT_FLOW_NAME = 'Starter research export';
