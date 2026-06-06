import type { Node } from '@xyflow/react';

export type NodeStatus = 'idle' | 'pending' | 'running' | 'success' | 'error';

export interface WorkbenchNodeData extends Record<string, unknown> {
  blockType: string;
  label: string;
  settings: Record<string, unknown>;
  status: NodeStatus;
}

export type WorkbenchNode = Node<WorkbenchNodeData, 'workbenchBlock'>;

export const DEFAULT_FLOW_ID = 'primary-flow';
export const DEFAULT_FLOW_NAME = 'Starter research export';
