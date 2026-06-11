import type {
  BuiltCommand,
  PersistedFlow,
  RunRecord,
  RunSampleMeta,
  RunStepIo,
  SingleNodeMode
} from './shared/types';
import type { FlowRequestBody } from './flowSerialization';
import type { WriteSummary } from './shared/writeActions';

/** How a single-node run sources its input: the node's own settings, or the
 *  cached upstream sample from the last full run. */
export type RunNodeMode = SingleNodeMode;

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
  /** Per-node I/O summary (counts + redacted sample), when the step recorded one. */
  io?: RunStepIo;
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
  /** Provenance for the preview rows: which block produced them and whether saved. */
  resultsMeta?: RunSampleMeta;
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

/**
 * Build an error message from a failed response, preferring the backend's
 * `{ error }` body (which carries the actionable detail — e.g. which flow field
 * is invalid) over a bare status code. Falls back to the status when the body is
 * missing or not JSON.
 */
async function readErrorMessage(response: Response, fallbackVerb: string): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown };
    if (body && typeof body.error === 'string' && body.error.trim()) {
      return body.error;
    }
  } catch {
    // Body was empty or not JSON; fall through to the status-based message.
  }
  return `${fallbackVerb} (status ${response.status})`;
}

export async function fetchHealth(): Promise<HealthResponse> {
  const response = await fetch('/api/health');
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, 'Backend health check failed'));
  }
  return (await response.json()) as HealthResponse;
}

export async function listFlows(): Promise<PersistedFlow[]> {
  const response = await fetch('/api/flows');
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, 'Failed to list flows'));
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
    throw new Error(await readErrorMessage(response, 'Failed to load flow'));
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
    throw new Error(await readErrorMessage(response, 'Failed to save flow'));
  }
  const payload = (await response.json()) as { flow: PersistedFlow };
  return payload.flow;
}

/**
 * Delete a saved flow and its run history. Resolves `true` when the backend
 * removed it (204), `false` when it was already gone (404) — both mean the flow
 * no longer exists, so callers can clear local state either way. Other failures
 * throw with the backend's error detail.
 */
export async function deleteFlow(flowId: string): Promise<boolean> {
  const response = await fetch(`/api/flows/${flowId}`, { method: 'DELETE' });
  if (response.status === 404) {
    return false;
  }
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, 'Failed to delete flow'));
  }
  return true;
}

/** Thrown by {@link postRun} when the backend requires confirmation for write actions. */
export class WriteConfirmationRequiredError extends Error {
  readonly writes: WriteSummary[];
  constructor(writes: WriteSummary[]) {
    super('WRITE_CONFIRMATION_REQUIRED');
    this.name = 'WriteConfirmationRequiredError';
    this.writes = writes;
  }
}

export async function postRun(flowId: string, confirmWrites = false): Promise<RunRecord> {
  const response = await fetch('/api/runs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ flowId, confirmWrites })
  });
  if (response.status === 409) {
    const body = (await response.json().catch(() => ({}))) as { code?: string; writes?: WriteSummary[] };
    if (body.code === 'WRITE_CONFIRMATION_REQUIRED') {
      throw new WriteConfirmationRequiredError(body.writes ?? []);
    }
  }
  let payload: { run?: RunRecord; error?: string };
  try {
    payload = (await response.json()) as { run?: RunRecord; error?: string };
  } catch {
    // No parseable body: a 5xx with an empty/HTML body or a mid-response network
    // failure. Distinguish from the expected "422 with a failed run" case below.
    throw new Error(`Run request failed (status ${response.status})`);
  }
  // A 422 still carries a failed RunRecord; only a missing run body is a real
  // error. Surface the server's error message when it provided one.
  if (!payload.run) {
    throw new Error(payload.error ?? `Run failed (status ${response.status})`);
  }
  return payload.run;
}

/**
 * Run a SINGLE node in isolation. `static` runs it on its own settings; `cached-upstream`
 * feeds it the cached output sample of its upstream nodes from the last full run.
 * Returns a one-step RunRecord; the backend keeps these ephemeral (not in run history).
 */
export async function postRunNode(flowId: string, nodeId: string, mode: RunNodeMode): Promise<RunRecord> {
  const response = await fetch('/api/runs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ flowId, nodeId, mode })
  });
  let payload: { run?: RunRecord; error?: string };
  try {
    payload = (await response.json()) as { run?: RunRecord; error?: string };
  } catch {
    throw new Error(`Run node request failed (status ${response.status})`);
  }
  // Mirror postRun: a 422 still carries a failed RunRecord; only a missing run is fatal.
  if (!payload.run) {
    throw new Error(payload.error ?? `Run node failed (status ${response.status})`);
  }
  return payload.run;
}

export async function listRuns(flowId: string): Promise<RunRecord[]> {
  const response = await fetch(`/api/runs/${flowId}`);
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, 'Failed to list runs'));
  }
  const payload = (await response.json()) as { runs?: RunRecord[] };
  return payload.runs ?? [];
}

export interface RunStepEvent {
  type: string;
  flowId?: string;
  step?: RunRecord['steps'][number];
}

export interface RunCompleteEvent {
  run: RunRecord;
}

/** Why onError fired: a transport/connection drop vs. an unparseable event. */
export interface RunEventError {
  phase: 'connection' | 'parse';
  /** EventSource.readyState (0=connecting, 1=open, 2=closed) when known. */
  readyState?: number;
}

export interface RunEventHandlers {
  onStep?: (event: RunStepEvent) => void;
  onComplete?: (event: RunCompleteEvent) => void;
  onError?: (error?: RunEventError) => void;
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
      handlers.onError?.({ phase: 'parse' });
    }
  });
  source.addEventListener('run-complete', (event) => {
    const parsed = parseEventData<RunCompleteEvent>((event as MessageEvent).data);
    if (parsed) {
      handlers.onComplete?.(parsed);
    } else {
      handlers.onError?.({ phase: 'parse' });
    }
  });
  // The browser EventSource auto-reconnects using the server's `retry` hint, so
  // an 'error' here is usually a transient drop, not fatal. Surface the
  // readyState so callers can say "reconnecting…" vs "stream closed".
  source.addEventListener('error', () => {
    handlers.onError?.({ phase: 'connection', readyState: source.readyState });
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
