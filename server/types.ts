import type { BuiltCommand } from '../src/shared/types';

export type {
  FlowDefinition,
  FlowSchedule,
  PersistedFlow,
  OutputFile,
  StepStatus,
  RunStep,
  RunRecord
} from '../src/shared/types';

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
