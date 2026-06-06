import type { Node } from '@xyflow/react';

export interface WorkbenchNodeData extends Record<string, unknown> {
  blockType: string;
  label: string;
  settings: Record<string, unknown>;
  status: 'idle' | 'success' | 'warning';
}

export type WorkbenchNode = Node<WorkbenchNodeData, 'workbenchBlock'>;

export const DEFAULT_FLOW_ID = 'primary-flow';
export const DEFAULT_FLOW_NAME = 'Starter research export';
