import { nanoid } from 'nanoid';
import type { RunRecord } from './types';

/**
 * Build a "no steps ran" terminal RunRecord (failed or skipped) with the full
 * canonical envelope. Single-sourced so the schemaVersion and required-field set
 * can't drift between the route layer and the engine's invalid-flow early return.
 */
export function makeTerminalRun(params: {
  flowId: string;
  status: Extract<RunRecord['status'], 'failed' | 'skipped'>;
  error: string | null;
  now?: () => Date;
}): RunRecord {
  const timestamp = (params.now ?? (() => new Date()))().toISOString();
  return {
    schemaVersion: 1,
    id: `${params.status}-${nanoid()}`,
    flowId: params.flowId,
    status: params.status,
    startedAt: timestamp,
    endedAt: timestamp,
    steps: [],
    outputFiles: [],
    error: params.error,
    sample: []
  };
}
