import type { ConsoleRunStep, ConsoleState } from './api';
import { getBlockSpec } from './shared/commandBuilders';
import type { RunRecord, RunStep } from './shared/types';

/**
 * Maps a backend RunRecord onto the console view model. The record only carries
 * step status + output file metadata (not the SocialItem rows), so the Output
 * Preview results stay empty and the artifacts surface as log lines instead.
 */
export function runRecordToConsoleState(
  run: RunRecord,
  prev: ConsoleState,
  nodeTypeById: Record<string, string> = {}
): ConsoleState {
  return {
    ...prev,
    activeTab: 'Logs',
    command: prev.command,
    runLabel: `Run ${run.startedAt}`,
    steps: run.steps.map((step) => toConsoleStep(step, nodeTypeById[step.blockId])),
    logs: buildLogs(run),
    results: []
  };
}

export function runStepToConsoleStep(step: RunStep, blockType: string | undefined): ConsoleRunStep {
  return toConsoleStep(step, blockType);
}

function toConsoleStep(step: RunStep, blockType: string | undefined): ConsoleRunStep {
  const descriptor = describeBlock(blockType, step.blockId);
  return {
    id: step.blockId,
    label: descriptor.label,
    sublabel: descriptor.sublabel,
    status: step.status,
    duration: formatDuration(step.startedAt, step.endedAt)
  };
}

function describeBlock(blockType: string | undefined, fallbackId: string): { label: string; sublabel: string } {
  if (!blockType) {
    return { label: fallbackId, sublabel: '' };
  }
  const spec = getBlockSpec(blockType);
  return {
    label: spec.label,
    sublabel: spec.command ? `${spec.command.executable} ${spec.provider}` : 'local block'
  };
}

function buildLogs(run: RunRecord): string[] {
  const logs: string[] = [`Run ${run.status} (${run.steps.length} steps)`];
  for (const step of run.steps) {
    if (step.status !== 'success' && step.error) {
      logs.push(`Step ${step.blockId} ${step.status}: ${step.error}`);
    }
  }
  for (const file of run.outputFiles) {
    logs.push(`Wrote ${file.path} (${file.bytes} bytes)`);
  }
  if (run.error) {
    logs.push(`Error: ${run.error}`);
  }
  return logs;
}

function formatDuration(startedAt: string, endedAt: string | null): string {
  if (!endedAt) {
    return '—';
  }
  const elapsedMs = new Date(endedAt).getTime() - new Date(startedAt).getTime();
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) {
    return '—';
  }
  return `${(elapsedMs / 1000).toFixed(2)}s`;
}
