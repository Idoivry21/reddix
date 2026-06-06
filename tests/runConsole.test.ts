import { describe, expect, it } from 'vitest';
import { runRecordToConsoleState, runStepToConsoleStep } from '../src/runConsole';
import type { ConsoleState } from '../src/api';
import type { RunRecord } from '../src/shared/types';

const prev: ConsoleState = {
  activeTab: 'Output Preview',
  command: undefined,
  steps: [],
  logs: ['old log'],
  results: [],
  runLabel: 'old'
};

const run: RunRecord = {
  schemaVersion: 1,
  id: 'run-1',
  flowId: 'primary',
  status: 'success',
  startedAt: '2026-06-06T15:00:00.000Z',
  endedAt: '2026-06-06T15:00:05.000Z',
  steps: [
    {
      blockId: 'search',
      status: 'success',
      startedAt: '2026-06-06T15:00:00.000Z',
      endedAt: '2026-06-06T15:00:01.500Z',
      exitCode: 0
    },
    {
      blockId: 'export',
      status: 'failed',
      startedAt: '2026-06-06T15:00:01.500Z',
      endedAt: '2026-06-06T15:00:02.000Z',
      error: 'disk full'
    }
  ],
  outputFiles: [{ path: 'outputs/export.json', bytes: 2048 }],
  error: null
};

const nodeTypeById = { search: 'reddit.searchPosts', export: 'output.exportJson' };

describe('runRecordToConsoleState', () => {
  it('maps run steps to console steps with labels and durations', () => {
    const state = runRecordToConsoleState(run, prev, nodeTypeById);

    expect(state.steps[0]).toMatchObject({
      id: 'search',
      label: 'Search Reddit',
      status: 'success',
      duration: '1.50s'
    });
    expect(state.steps[1]).toMatchObject({ id: 'export', status: 'failed' });
  });

  it('summarizes output files and step errors in logs', () => {
    const state = runRecordToConsoleState(run, prev, nodeTypeById);

    expect(state.logs.some((log) => log.includes('outputs/export.json'))).toBe(true);
    expect(state.logs.some((log) => log.includes('disk full'))).toBe(true);
  });

  it('preserves the selected command and switches to the Logs tab', () => {
    const withCommand: ConsoleState = { ...prev, command: undefined };
    const state = runRecordToConsoleState(run, withCommand, nodeTypeById);

    expect(state.activeTab).toBe('Logs');
    expect(state.command).toBe(withCommand.command);
  });
});

describe('runStepToConsoleStep', () => {
  it('maps a single run step using the resolved block label', () => {
    const consoleStep = runStepToConsoleStep(run.steps[0], 'reddit.searchPosts');

    expect(consoleStep).toMatchObject({ id: 'search', label: 'Search Reddit', status: 'success' });
  });

  it('falls back to the block id when the type is unknown', () => {
    const consoleStep = runStepToConsoleStep(run.steps[0], undefined);

    expect(consoleStep).toMatchObject({ id: 'search', label: 'search', sublabel: '' });
  });
});
