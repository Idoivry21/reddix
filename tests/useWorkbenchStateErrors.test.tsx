import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useWorkbenchState } from '../src/hooks/useWorkbenchState';
import type { SavedSchedule } from '../src/components/ScheduleModal';
import type { PersistedFlow } from '../src/shared/types';

/**
 * Error-path coverage for the workbench state machine: runNow's save-then-post
 * sequence when each leg fails, saveSchedule success/failure, and openFlow's
 * same-id short-circuit / 404 / rehydrate paths. The happy paths live in
 * useWorkbenchState.test.tsx.
 */

type FetchInit = RequestInit | undefined;

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as unknown as Response;
}

function methodOf(init: FetchInit): string {
  return init?.method ?? 'GET';
}

function fetchCalls(): Array<[string, FetchInit]> {
  return (global.fetch as unknown as { mock: { calls: Array<[RequestInfo | URL, FetchInit]> } }).mock.calls.map(
    ([url, init]) => [String(url), init]
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('runNow error paths', () => {
  it('aborts before POST /api/runs and surfaces the save error when saveFlow fails', async () => {
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: FetchInit) => {
      const url = String(input);
      if (methodOf(init) === 'PUT' && url.includes('/api/flows/')) {
        return jsonResponse({ error: 'Invalid flow graph: node3: bad' }, false, 422);
      }
      if (/\/api\/runs\/[^/]+$/.test(url)) {
        return jsonResponse({ runs: [] });
      }
      return jsonResponse({ flow: {} });
    }) as unknown as typeof fetch;

    const { result } = renderHook(() => useWorkbenchState());
    await act(async () => {
      await result.current.runNow();
    });

    expect(result.current.runStatus.kind).toBe('error');
    expect(result.current.runStatus.message).toContain('Invalid flow graph');
    expect(result.current.isRunning).toBe(false);
    // The run must NOT be POSTed when the save failed.
    expect(fetchCalls().some(([url, init]) => url === '/api/runs' && methodOf(init) === 'POST')).toBe(false);
    expect(result.current.toasts.some((toast) => toast.kind === 'error')).toBe(true);
  });

  it('surfaces the run error when saveFlow succeeds but postRun fails', async () => {
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: FetchInit) => {
      const url = String(input);
      if (url === '/api/runs' && methodOf(init) === 'POST') {
        return jsonResponse({ error: 'CLI binary missing' }, false, 422);
      }
      if (/\/api\/runs\/[^/]+$/.test(url)) {
        return jsonResponse({ runs: [] });
      }
      return jsonResponse({ flow: {} });
    }) as unknown as typeof fetch;

    const { result } = renderHook(() => useWorkbenchState());
    await act(async () => {
      await result.current.runNow();
    });

    expect(result.current.runStatus.kind).toBe('error');
    expect(result.current.runStatus.message).toContain('CLI binary missing');
    expect(result.current.isRunning).toBe(false);
  });
});

describe('saveSchedule', () => {
  const schedule: SavedSchedule = { enabled: true, cron: '0 9 * * 1', intervalMs: 900_000 };

  it('persists the schedule and reports success', async () => {
    global.fetch = vi.fn(async () => jsonResponse({ flow: {} })) as unknown as typeof fetch;

    const { result } = renderHook(() => useWorkbenchState());
    await act(async () => {
      await result.current.saveSchedule(schedule);
    });

    expect(result.current.schedule).toEqual({ enabled: true, cron: '0 9 * * 1' });
    expect(result.current.showSchedule).toBe(false);
    expect(result.current.runStatus.message).toBe('Schedule saved');
    expect(result.current.toasts.some((toast) => toast.kind === 'success')).toBe(true);
  });

  it('reports a failure when the save request fails', async () => {
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: FetchInit) => {
      if (methodOf(init) === 'PUT') {
        return jsonResponse({ error: 'disk full' }, false, 500);
      }
      return jsonResponse({ flow: {} });
    }) as unknown as typeof fetch;

    const { result } = renderHook(() => useWorkbenchState());
    await act(async () => {
      await result.current.saveSchedule(schedule);
    });

    expect(result.current.runStatus.kind).toBe('error');
    expect(result.current.runStatus.message).toContain('disk full');
    expect(result.current.toasts.some((toast) => toast.kind === 'error')).toBe(true);
  });
});

describe('openFlow', () => {
  it('short-circuits to closing the dashboard when opening the already-active flow', async () => {
    global.fetch = vi.fn(async () => jsonResponse({ runs: [] })) as unknown as typeof fetch;

    const { result } = renderHook(() => useWorkbenchState());
    const beforeNodes = result.current.nodes;
    const activeId = result.current.activeFlowId;

    await act(async () => {
      await result.current.openFlow(activeId);
    });

    expect(result.current.showDashboard).toBe(false);
    expect(result.current.activeFlowId).toBe(activeId);
    expect(result.current.nodes).toBe(beforeNodes);
    // No GET for the flow body should have been issued.
    expect(fetchCalls().some(([url]) => url === `/api/flows/${activeId}`)).toBe(false);
  });

  it('shows an error and leaves the canvas untouched when the flow is not found (404)', async () => {
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/flows/missing-flow') {
        return jsonResponse({ error: 'Flow not found' }, false, 404);
      }
      return jsonResponse({ runs: [] });
    }) as unknown as typeof fetch;

    const { result } = renderHook(() => useWorkbenchState());
    const beforeNodes = result.current.nodes;
    const activeId = result.current.activeFlowId;

    await act(async () => {
      await result.current.openFlow('missing-flow');
    });

    expect(result.current.runStatus.message).toBe('Flow not found');
    expect(result.current.toasts.some((toast) => toast.kind === 'error')).toBe(true);
    expect(result.current.activeFlowId).toBe(activeId);
    expect(result.current.nodes).toBe(beforeNodes);
  });

  it('rehydrates the canvas from a persisted flow on success', async () => {
    const persisted: PersistedFlow = {
      schemaVersion: 1,
      id: 'flow-2',
      name: 'Second Flow',
      failFast: false,
      nodes: [{ id: 'n1', type: 'reddit.searchPosts', settings: { query: 'cli' } }],
      edges: [],
      nodePositions: { n1: { x: 10, y: 20 } },
      blockSettings: {},
      schedule: { enabled: false },
      createdAt: '2026-06-07T12:00:00.000Z',
      updatedAt: '2026-06-07T12:00:00.000Z'
    };
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/flows/flow-2') {
        return jsonResponse({ flow: persisted });
      }
      return jsonResponse({ runs: [] });
    }) as unknown as typeof fetch;

    const { result } = renderHook(() => useWorkbenchState());

    await act(async () => {
      await result.current.openFlow('flow-2');
    });

    await waitFor(() => expect(result.current.activeFlowId).toBe('flow-2'));
    expect(result.current.flowName).toBe('Second Flow');
    expect(result.current.nodes).toHaveLength(1);
    expect(result.current.nodes[0].blockType).toBe('reddit.searchPosts');
    expect(result.current.showDashboard).toBe(false);
  });
});
