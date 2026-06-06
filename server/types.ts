import type { BuiltCommand } from '../src/shared/types';
import type { FlowEdgeModel, FlowNodeModel } from '../src/shared/graph';

export interface FlowDefinition {
  id: string;
  name: string;
  failFast?: boolean;
  nodes: FlowNodeModel[];
  edges: FlowEdgeModel[];
}

export interface PersistedFlow extends FlowDefinition {
  schemaVersion: 1;
  nodePositions: Record<string, { x: number; y: number }>;
  blockSettings: Record<string, Record<string, unknown>>;
  schedule: FlowSchedule;
  createdAt: string;
  updatedAt: string;
}

export interface FlowSchedule {
  enabled: boolean;
  intervalMs?: number;
  paused?: boolean;
  nextRunAt?: string | null;
}

export type StepStatus = 'success' | 'failed' | 'skipped';

export interface RunStep {
  blockId: string;
  status: StepStatus;
  argv?: string[];
  exitCode?: number | null;
  stdoutSummary?: string;
  stderr?: string;
  startedAt: string;
  endedAt: string;
  error?: string | null;
}

export interface RunRecord {
  schemaVersion: 1;
  id: string;
  flowId: string;
  status: 'success' | 'failed' | 'skipped' | 'running';
  startedAt: string;
  endedAt: string | null;
  steps: RunStep[];
  outputFiles: Array<{ path: string; bytes: number }>;
  error: string | null;
}

export interface Preferences {
  schemaVersion: 1;
  defaultExportDir: string;
  selectedFlowId: string | null;
}

export interface ExecutorResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export type CliExecutor = (command: BuiltCommand) => Promise<ExecutorResult>;

