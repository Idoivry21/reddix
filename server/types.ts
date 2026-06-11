import type { BuiltCommand } from '../src/shared/types';

export type { FlowDefinition, PersistedFlow, RunStep, RunRecord } from '../src/shared/types';

export interface Preferences {
  schemaVersion: 1;
  defaultExportDir: string;
  /** Persisted "last open flow" hint. Currently stored only — not yet wired into
   * any route or the frontend's activeFlowId state. */
  selectedFlowId: string | null;
}

export interface ExecutorResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export type CliExecutor = (command: BuiltCommand) => Promise<ExecutorResult>;
