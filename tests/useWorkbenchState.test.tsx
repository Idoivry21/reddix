import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkbenchState } from '../src/hooks/useWorkbenchState';
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
  vi.unstubAllGlobals();
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

  it('runs a single node, refreshing only that node and its io preview', async () => {
    const nodeRun: RunRecord = {
      schemaVersion: 1,
      id: 'noderun-1',
      flowId: 'primary-flow',
      status: 'success',
      startedAt: '2026-06-07T12:00:00.000Z',
      endedAt: '2026-06-07T12:00:01.000Z',
      steps: [
        {
          blockId: 'reddit-search',
          status: 'success',
          startedAt: '2026-06-07T12:00:00.000Z',
          endedAt: '2026-06-07T12:00:01.000Z',
          io: { inputCount: 0, outputCount: 3, skippedCount: 1, normalizedFields: ['id', 'title'], sampleItems: [] }
        }
      ],
      outputFiles: [],
      error: null,
      trigger: { kind: 'single-node', nodeId: 'reddit-search', mode: 'static' }
    };
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/runs') {
        return jsonResponse({ run: nodeRun });
      }
      if (/\/api\/runs\/[^/]+$/.test(url)) {
        return jsonResponse({ runs: [] });
      }
      return jsonResponse({ flow: {} });
    }) as unknown as typeof fetch;

    const { result } = renderHook(() => useWorkbenchState());

    await act(async () => {
      await result.current.runNode('reddit-search', 'static');
    });

    await waitFor(() => {
      expect(result.current.nodeIoPreview['reddit-search']).toMatchObject({
        outputCount: 3,
        skippedCount: 1,
        status: 'success'
      });
    });
    // A single-node run must not touch the rest of the canvas.
    expect(result.current.nodes.find((node) => node.id === 'reddit-filter')?.status).toBe('idle');
  });

  it('reports upstream and cached-upstream availability', async () => {
    const fullRun: RunRecord = {
      schemaVersion: 1,
      id: 'full-1',
      flowId: 'primary-flow',
      status: 'success',
      startedAt: '2026-06-07T12:00:00.000Z',
      endedAt: '2026-06-07T12:00:02.000Z',
      steps: [
        {
          blockId: 'reddit-search',
          status: 'success',
          startedAt: '2026-06-07T12:00:00.000Z',
          endedAt: '2026-06-07T12:00:01.000Z',
          io: { inputCount: 0, outputCount: 5, skippedCount: 0, normalizedFields: ['id'], sampleItems: [] }
        }
      ],
      outputFiles: [],
      error: null
    };
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/runs') {
        return jsonResponse({ run: fullRun });
      }
      if (/\/api\/runs\/[^/]+$/.test(url)) {
        return jsonResponse({ runs: [] });
      }
      return jsonResponse({ flow: {} });
    }) as unknown as typeof fetch;

    const { result } = renderHook(() => useWorkbenchState());

    expect(result.current.hasUpstream('reddit-search')).toBe(false);
    expect(result.current.hasUpstream('reddit-filter')).toBe(true);
    expect(result.current.hasCachedUpstream('reddit-filter')).toBe(false);

    await act(async () => {
      await result.current.runNow();
    });

    await waitFor(() => {
      expect(result.current.hasCachedUpstream('reddit-filter')).toBe(true);
    });
  });

  it('surfaces live update stream errors while a run is active', async () => {
    const listeners: Record<string, (event: MessageEvent) => void> = {};
    class FakeEventSource {
      readyState = 0;
      addEventListener(type: string, handler: (event: MessageEvent) => void) {
        listeners[type] = handler;
      }
      close = vi.fn();
    }
    vi.stubGlobal('EventSource', FakeEventSource);

    let resolveRun!: (response: Response) => void;
    const pendingRun = new Promise<Response>((resolve) => {
      resolveRun = resolve;
    });
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (/\/api\/runs\/[^/]+$/.test(url)) {
        return jsonResponse({ runs: [] });
      }
      if (url === '/api/runs') {
        return pendingRun;
      }
      return jsonResponse({ flow: {} });
    }) as unknown as typeof fetch;

    const { result } = renderHook(() => useWorkbenchState());
    let runNowPromise: Promise<void> = Promise.resolve();
    await act(async () => {
      runNowPromise = result.current.runNow();
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(result.current.isRunning).toBe(true);
    });

    act(() => {
      listeners.error?.({ data: '' } as MessageEvent);
    });

    expect(result.current.consoleState.logs[0]).toMatch(/live updates/i);
    expect(result.current.toasts.some((toast) => /live updates/i.test(toast.message))).toBe(true);

    await act(async () => {
      resolveRun(jsonResponse({ run: runWithReport }));
      await runNowPromise;
    });
  });
});

describe('useWorkbenchState spliceNodeIntoEdge', () => {
  it('replaces an edge with source→node→target using compatible ports', () => {
    const { result } = renderHook(() => useWorkbenchState());

    act(() => {
      result.current.addBlock('transform.limit', 700, 280);
    });
    const newId = result.current.selectedNodeId as string;

    act(() => {
      result.current.spliceNodeIntoEdge(newId, 'e-merge-sort');
    });

    const { edges } = result.current;
    expect(edges.some((edge) => edge.id === 'e-merge-sort')).toBe(false);
    expect(
      edges.some((edge) => edge.source === 'merge' && edge.target === newId && edge.targetPortId === 'items')
    ).toBe(true);
    expect(
      edges.some((edge) => edge.source === newId && edge.target === 'sort' && edge.targetPortId === 'items')
    ).toBe(true);
  });

  it('rejects a pure Source node, leaving the edge intact and toasting', () => {
    const { result } = renderHook(() => useWorkbenchState());

    act(() => {
      result.current.addBlock('reddit.searchPosts', 700, 280);
    });
    const sourceId = result.current.selectedNodeId as string;
    const before = result.current.edges;

    act(() => {
      result.current.spliceNodeIntoEdge(sourceId, 'e-merge-sort');
    });

    // No-op: same edges array reference (immutable, untouched) and an error toast.
    expect(result.current.edges).toBe(before);
    expect(result.current.edges.some((edge) => edge.id === 'e-merge-sort')).toBe(true);
    expect(result.current.toasts.some((toast) => toast.kind === 'error')).toBe(true);
  });

  it('preserves a pre-existing node edge and does not duplicate it on splice', () => {
    const { result } = renderHook(() => useWorkbenchState());

    act(() => {
      result.current.addBlock('transform.limit', 700, 280);
    });
    const newId = result.current.selectedNodeId as string;
    // Wire merge→newId first, then splice newId into merge→sort: the splice's own
    // merge→newId addition must be deduped against the edge that already exists.
    act(() => {
      result.current.connect('merge', 'items', newId, 'items');
    });

    act(() => {
      result.current.spliceNodeIntoEdge(newId, 'e-merge-sort');
    });

    const { edges } = result.current;
    expect(edges.some((edge) => edge.id === 'e-merge-sort')).toBe(false);
    expect(edges.filter((edge) => edge.source === 'merge' && edge.target === newId)).toHaveLength(1);
    expect(edges.some((edge) => edge.source === newId && edge.target === 'sort')).toBe(true);
  });
});

describe('useWorkbenchState history load race across flow switches', () => {
  function runRecord(id: string, flowId: string): RunRecord {
    return {
      schemaVersion: 1,
      id,
      flowId,
      status: 'success',
      startedAt: '2026-06-01T00:00:00.000Z',
      endedAt: '2026-06-01T00:00:01.000Z',
      steps: [],
      outputFiles: [],
      error: null
    };
  }

  it('does not merge a slow default-flow history response into a flow opened mid-flight', async () => {
    // The default-flow history fetch fired on mount is gated so it resolves only
    // AFTER the user has already switched to another flow.
    let releasePrimaryHistory!: () => void;
    const primaryHistoryGate = new Promise<void>((resolve) => {
      releasePrimaryHistory = resolve;
    });

    const otherFlow = {
      schemaVersion: 1,
      id: 'other-flow',
      name: 'Other Flow',
      failFast: false,
      nodes: [],
      edges: [],
      nodePositions: {},
      blockSettings: {},
      schedule: { enabled: false },
      createdAt: '2026-06-01T00:00:00.000Z',
      updatedAt: '2026-06-01T00:00:00.000Z'
    };

    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/runs/primary-flow') {
        await primaryHistoryGate;
        return jsonResponse({ runs: [runRecord('default-run-1', 'primary-flow')] });
      }
      if (url === '/api/runs/other-flow') {
        return jsonResponse({ runs: [runRecord('other-run-1', 'other-flow')] });
      }
      if (url === '/api/flows/other-flow') {
        return jsonResponse({ flow: otherFlow });
      }
      return jsonResponse({ flow: {} });
    }) as unknown as typeof fetch;

    const { result } = renderHook(() => useWorkbenchState());

    await act(async () => {
      await result.current.openFlow('other-flow');
    });
    await waitFor(() => {
      expect(result.current.consoleState.history.map((entry) => entry.id)).toContain('other-run-1');
    });

    // Now let the stale primary-flow history resolve and flush its merge.
    await act(async () => {
      releasePrimaryHistory();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const ids = result.current.consoleState.history.map((entry) => entry.id);
    expect(ids).toContain('other-run-1');
    expect(ids).not.toContain('default-run-1');
  });
});
