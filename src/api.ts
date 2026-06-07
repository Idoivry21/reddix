import type { BuiltCommand, PersistedFlow, RunRecord } from './shared/types';
import type { FlowRequestBody } from './flowSerialization';

export interface ConsoleRunStep {
  id: string;
  label: string;
  sublabel: string;
  status: 'success' | 'failed' | 'skipped' | 'running';
  duration: string;
  /** Redacted displayArgv for CLI steps; undefined for local steps. */
  argv?: string[];
  exitCode?: number | null;
  stdoutSummary?: string;
  error?: string | null;
}

export interface ConsoleHistoryEntry {
  id: string;
  status: 'success' | 'failed' | 'skipped' | 'running';
  startedAt: string;
  steps: number;
  error: string | null;
}

export interface ConsoleState {
  activeTab: 'Command Trace' | 'Logs' | 'Output Preview' | 'History';
  command?: BuiltCommand;
  steps: ConsoleRunStep[];
  logs: string[];
  results: Array<Record<string, string | number | null>>;
  history: ConsoleHistoryEntry[];
  runLabel: string;
  /** Relative artifact path of the most recent HTML report, if a run produced one. */
  reportPath?: string;
}

export interface ProviderHealth {
  provider: string;
  executable: string;
  available: boolean;
}

export interface HealthResponse {
  ok: boolean;
  app: string;
  providers: ProviderHealth[];
}

export async function fetchHealth(): Promise<HealthResponse> {
  const response = await fetch('/api/health');
  if (!response.ok) {
    throw new Error('Backend health check failed');
  }
  return (await response.json()) as HealthResponse;
}

export async function listFlows(): Promise<PersistedFlow[]> {
  const response = await fetch('/api/flows');
  if (!response.ok) {
    throw new Error(`Failed to list flows (status ${response.status})`);
  }
  const payload = (await response.json()) as { flows?: PersistedFlow[] };
  return payload.flows ?? [];
}

export async function getFlow(flowId: string): Promise<PersistedFlow | null> {
  const response = await fetch(`/api/flows/${flowId}`);
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`Failed to load flow (status ${response.status})`);
  }
  const payload = (await response.json()) as { flow: PersistedFlow };
  return payload.flow;
}

export async function saveFlow(flowId: string, body: FlowRequestBody): Promise<PersistedFlow> {
  const response = await fetch(`/api/flows/${flowId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    throw new Error(`Failed to save flow (status ${response.status})`);
  }
  const payload = (await response.json()) as { flow: PersistedFlow };
  return payload.flow;
}

export async function postRun(flowId: string): Promise<RunRecord> {
  const response = await fetch('/api/runs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ flowId })
  });
  let payload: { run?: RunRecord };
  try {
    payload = (await response.json()) as { run?: RunRecord };
  } catch {
    throw new Error(`Run failed (status ${response.status})`);
  }
  // A 422 still carries a failed RunRecord; only a missing body is a real error.
  if (!payload.run) {
    throw new Error(`Run failed (status ${response.status})`);
  }
  return payload.run;
}

export async function listRuns(flowId: string): Promise<RunRecord[]> {
  const response = await fetch(`/api/runs/${flowId}`);
  if (!response.ok) {
    throw new Error(`Failed to list runs (status ${response.status})`);
  }
  const payload = (await response.json()) as { runs?: RunRecord[] };
  return payload.runs ?? [];
}

export interface RunStepEvent {
  type: string;
  step?: RunRecord['steps'][number];
}

export interface RunCompleteEvent {
  run: RunRecord;
}

export interface RunEventHandlers {
  onStep?: (event: RunStepEvent) => void;
  onComplete?: (event: RunCompleteEvent) => void;
  onError?: () => void;
}

type EventSourceFactory = (url: string) => EventSource;

/**
 * Subscribes to the backend SSE stream for live run-step updates. Returns an
 * unsubscribe function. The EventSource factory is injectable for testing and
 * environments (jsdom) without a global EventSource.
 */
export function subscribeRunEvents(
  handlers: RunEventHandlers,
  factory: EventSourceFactory = (url) => new EventSource(url)
): () => void {
  const source = factory('/events');

  source.addEventListener('run-step', (event) => {
    const parsed = parseEventData<RunStepEvent>((event as MessageEvent).data);
    if (parsed) {
      handlers.onStep?.(parsed);
    } else {
      handlers.onError?.();
    }
  });
  source.addEventListener('run-complete', (event) => {
    const parsed = parseEventData<RunCompleteEvent>((event as MessageEvent).data);
    if (parsed) {
      handlers.onComplete?.(parsed);
    } else {
      handlers.onError?.();
    }
  });
  source.addEventListener('error', () => {
    handlers.onError?.();
  });

  return () => source.close();
}

function parseEventData<T>(data: string): T | null {
  try {
    return JSON.parse(data) as T;
  } catch {
    return null;
  }
}
