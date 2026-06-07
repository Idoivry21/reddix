import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkbenchState } from '../src/hooks/useFlowState';
import type { RunRecord } from '../src/shared/types';

const runWithReport: RunRecord = {
  schemaVersion: 1,
  id: 'run-html-1',
  flowId: 'primary-flow',
  status: 'success',
  startedAt: '2026-06-07T12:00:00.000Z',
  endedAt: '2026-06-07T12:00:03.000Z',
  steps: [],
  outputFiles: [
    { path: 'outputs/research-20260607-120000.csv', bytes: 100 },
    { path: 'outputs/report-20260607-120000.html', bytes: 4096 }
  ],
  error: null
};

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

beforeEach(() => {
  // Drive runNow's saveFlow (PUT /api/flows/:id) and postRun (POST /api/runs)
  // without a backend, returning a run that produced an HTML report.
  global.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/api/runs')) {
      return jsonResponse({ run: runWithReport });
    }
    return jsonResponse({ flow: {} });
  }) as unknown as typeof fetch;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useWorkbenchState run → report link wiring', () => {
  it('surfaces the HTML report path on the console state after a run completes', async () => {
    const { result } = renderHook(() => useWorkbenchState());

    await act(async () => {
      await result.current.runNow();
    });

    await waitFor(() => {
      expect(result.current.consoleState.reportPath).toBe('outputs/report-20260607-120000.html');
    });
  });

  it('clears the report link when the console is cleared', async () => {
    const { result } = renderHook(() => useWorkbenchState());

    await act(async () => {
      await result.current.runNow();
    });
    await waitFor(() => {
      expect(result.current.consoleState.reportPath).toBe('outputs/report-20260607-120000.html');
    });

    act(() => {
      result.current.clearConsole();
    });

    expect(result.current.consoleState.reportPath).toBeUndefined();
  });
});

describe('useWorkbenchState validation, progress, and history', () => {
  it('pushes an error toast when an incompatible connection is attempted', () => {
    const { result } = renderHook(() => useWorkbenchState());

    act(() => {
      // reddit-search is a source with no inputs → connecting into it is invalid.
      result.current.connect('reddit-filter', 'items', 'reddit-search', 'items');
    });

    expect(result.current.toasts.some((toast) => toast.kind === 'error')).toBe(true);
  });

  it('derives run progress from completed console steps and node count', () => {
    const { result } = renderHook(() => useWorkbenchState());
    expect(result.current.runProgress).toEqual({ done: 0, total: result.current.nodes.length });
  });

  it('loads persisted run history on mount and dedupes by id', async () => {
    const persisted: RunRecord = { ...runWithReport, id: 'hist-1' };
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (/\/api\/runs\/[^/]+$/.test(url)) {
        return jsonResponse({ runs: [persisted, persisted] });
      }
      if (url.includes('/api/runs')) {
        return jsonResponse({ run: runWithReport });
      }
      return jsonResponse({ flow: {} });
    }) as unknown as typeof fetch;

    const { result } = renderHook(() => useWorkbenchState());

    await waitFor(() => {
      const matches = result.current.consoleState.history.filter((entry) => entry.id === 'hist-1');
      expect(matches).toHaveLength(1);
    });
  });
});
