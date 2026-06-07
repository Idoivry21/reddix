import type { ConsoleHistoryEntry, ConsoleRunStep, ConsoleState } from './api';
import { getBlockSpec } from './shared/commandBuilders';
import type { RunRecord, RunSampleRow, RunStep } from './shared/types';

/** Cap on retained run-history entries. Shared with useWorkbenchState so both the
 * builder here and the merge there enforce the same bound. */
export const MAX_HISTORY_ENTRIES = 50;
const MAX_LOG_LINES = 200;

/** Keep only the most recent MAX_LOG_LINES entries to bound console memory. */
export function capLogs(logs: string[], max = MAX_LOG_LINES): string[] {
  return logs.length > max ? logs.slice(-max) : logs;
}

/**
 * Maps a backend RunRecord onto the console view model. The run carries a capped,
 * redacted `sample` of the items it produced, which becomes the Output Preview
 * rows; output artifacts also surface as log lines.
 */
export function runRecordToConsoleState(
  run: RunRecord,
  prev: ConsoleState,
  nodeTypeById: Record<string, string> = {}
): ConsoleState {
  return {
    ...prev,
    activeTab: 'Logs',
    runLabel: `Run ${run.startedAt}`,
    steps: run.steps.map((step) => toConsoleStep(step, nodeTypeById[step.blockId])),
    logs: capLogs(buildLogs(run)),
    results: toResultRows(run.sample),
    reportPath: latestHtmlReport(run),
    // Dedupe by run id: SSE onComplete and the REST response both map the same
    // run, so filter any existing entry for this id before prepending.
    history: [toHistoryEntry(run), ...(prev.history ?? []).filter((entry) => entry.id !== run.id)].slice(
      0,
      MAX_HISTORY_ENTRIES
    )
  };
}

/**
 * The most recent HTML report artifact a run produced, used by the console to
 * surface an "Open report" link. Output files are appended in node order, so the
 * last `.html` entry is the freshest report.
 */
function latestHtmlReport(run: RunRecord): string | undefined {
  for (let index = run.outputFiles.length - 1; index >= 0; index -= 1) {
    if (run.outputFiles[index].path.toLowerCase().endsWith('.html')) {
      return run.outputFiles[index].path;
    }
  }
  return undefined;
}

export function toHistoryEntry(run: RunRecord): ConsoleHistoryEntry {
  return {
    id: run.id,
    status: run.status,
    startedAt: run.startedAt,
    steps: run.steps.length,
    error: run.error
  };
}

/** Newest-first comparator over anything with an ISO `startedAt`. Shared so the
 * persisted-history and session-merge sorts can never order differently. */
export function byStartedAtDesc(a: { startedAt: string }, b: { startedAt: string }): number {
  return a.startedAt < b.startedAt ? 1 : -1;
}

/** Map persisted runs into history entries, newest-first and capped. */
export function runsToHistoryEntries(runs: RunRecord[]): ConsoleHistoryEntry[] {
  return [...runs]
    .sort(byStartedAtDesc)
    .slice(0, MAX_HISTORY_ENTRIES)
    .map(toHistoryEntry);
}

/** Project the run sample into the generic row shape the Output Preview renders. */
export function toResultRows(
  sample: RunSampleRow[] | undefined
): Array<Record<string, string | number | null>> {
  if (!sample) {
    return [];
  }
  return sample.map((row) => ({
    platform: row.platform,
    id: row.id,
    title: row.title,
    author: row.author,
    score: row.score,
    created: row.created,
    url: row.url
  }));
}

export function toConsoleStep(step: RunStep, blockType: string | undefined): ConsoleRunStep {
  const descriptor = describeBlock(blockType, step.blockId);
  return {
    id: step.blockId,
    label: descriptor.label,
    sublabel: descriptor.sublabel,
    status: step.status,
    duration: formatDuration(step.startedAt, step.endedAt),
    argv: step.argv,
    exitCode: step.exitCode,
    stdoutSummary: step.stdoutSummary,
    error: step.error
  };
}

function describeBlock(blockType: string | undefined, fallbackId: string): { label: string; sublabel: string } {
  if (!blockType) {
    return { label: fallbackId, sublabel: '' };
  }
  const spec = getBlockSpec(blockType);
  return {
    label: spec.label,
    sublabel: spec.executable ? `${spec.executable} ${spec.provider}` : 'local block'
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
