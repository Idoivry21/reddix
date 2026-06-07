interface ScheduleRegistration {
  intervalMs: number;
  enabled: boolean;
  paused?: boolean;
  /** Providers this flow touches (e.g. ['reddit','twitter']) for spacing. */
  providers: string[];
}

interface SchedulerOptions {
  minIntervalMs: number;
  jitterMs: number;
  /** Minimum gap between firing two flows that hit the same provider. */
  providerSpacingMs?: number;
  /** Maximum number of flows that may execute at once across all triggers. */
  maxConcurrentRuns?: number;
  /** How often the internal timer evaluates due flows. */
  tickMs?: number;
  runFlow: (flowId: string) => Promise<unknown>;
  onSkip: (flowId: string) => Promise<unknown>;
  now?: () => number;
  random?: () => number;
}

interface ScheduleState extends ScheduleRegistration {
  nextRunAt: number;
}

const DEFAULT_PROVIDER_SPACING_MS = 5_000;
const DEFAULT_TICK_MS = 30_000;
const DEFAULT_MAX_CONCURRENT_RUNS = 8;

export function createScheduler(options: SchedulerOptions) {
  const now = options.now ?? (() => Date.now());
  const random = options.random ?? Math.random;
  const providerSpacingMs = options.providerSpacingMs ?? DEFAULT_PROVIDER_SPACING_MS;
  const tickMs = options.tickMs ?? DEFAULT_TICK_MS;
  const maxConcurrentRuns = Math.max(1, Math.floor(options.maxConcurrentRuns ?? DEFAULT_MAX_CONCURRENT_RUNS));

  const running = new Set<string>();
  const schedules = new Map<string, ScheduleState>();
  const lastProviderFireAt = new Map<string, number>();
  const waiters: Array<() => void> = [];
  let activeRuns = 0;
  let timer: ReturnType<typeof setInterval> | null = null;
  let tickInFlight = false;

  function computeNextRunAt(intervalMs: number, from: number): number {
    const safeInterval = Math.max(intervalMs, options.minIntervalMs);
    const jitter = options.jitterMs > 0 ? Math.floor(random() * options.jitterMs) : 0;
    return from + safeInterval + jitter;
  }

  /** Legacy Date-returning helper retained for callers/tests. */
  function nextRunAt(intervalMs: number, fromDate = new Date(now())): Date {
    return new Date(computeNextRunAt(intervalMs, fromDate.getTime()));
  }

  async function acquireRunSlot(): Promise<void> {
    if (activeRuns < maxConcurrentRuns) {
      activeRuns += 1;
      return;
    }
    await new Promise<void>((resolve) => waiters.push(resolve));
  }

  function releaseRunSlot(): void {
    const next = waiters.shift();
    if (next) {
      next();
      return;
    }
    activeRuns -= 1;
  }

  async function triggerNow(flowId: string): Promise<unknown> {
    if (running.has(flowId)) {
      return options.onSkip(flowId);
    }
    running.add(flowId);
    await acquireRunSlot();
    try {
      return await options.runFlow(flowId);
    } finally {
      releaseRunSlot();
      running.delete(flowId);
    }
  }

  function register(flowId: string, registration: ScheduleRegistration): void {
    schedules.set(flowId, {
      ...registration,
      nextRunAt: computeNextRunAt(registration.intervalMs, now())
    });
  }

  function unregister(flowId: string): void {
    schedules.delete(flowId);
  }

  function getNextRunAt(flowId: string): number | null {
    return schedules.get(flowId)?.nextRunAt ?? null;
  }

  async function triggerDue(
    flowId: string
  ): Promise<{ triggered: false; nextRunAt: number | null } | { triggered: true; result: unknown; nextRunAt: number | null }> {
    const state = schedules.get(flowId);
    if (!state || !state.enabled || state.paused) {
      return { triggered: false, nextRunAt: state?.nextRunAt ?? null };
    }
    const at = now();
    if (at < state.nextRunAt || !isProviderSpaced(state.providers, at)) {
      return { triggered: false, nextRunAt: state.nextRunAt };
    }
    for (const provider of state.providers) {
      lastProviderFireAt.set(provider, at);
    }
    const nextRunAt = computeNextRunAt(state.intervalMs, at);
    schedules.set(flowId, { ...state, nextRunAt });
    const result = await triggerNow(flowId);
    return { triggered: true, result, nextRunAt };
  }

  function isProviderSpaced(providers: string[], at: number): boolean {
    return providers.every((provider) => {
      const last = lastProviderFireAt.get(provider);
      return last === undefined || at - last >= providerSpacingMs;
    });
  }

  async function tick(): Promise<void> {
    if (tickInFlight) {
      return;
    }
    tickInFlight = true;
    try {
      const at = now();
      const due = [...schedules.entries()]
        .filter(([, state]) => state.enabled && !state.paused && at >= state.nextRunAt)
        .sort((a, b) => a[1].nextRunAt - b[1].nextRunAt);

      for (const [flowId, state] of due) {
        // Per-provider spacing: defer (do NOT advance next-run) so this flow is
        // retried on the next tick once the provider window clears.
        if (!isProviderSpaced(state.providers, at)) {
          continue;
        }
        await triggerDue(flowId);
      }
    } finally {
      tickInFlight = false;
    }
  }

  function start(): void {
    if (timer) {
      return;
    }
    timer = setInterval(() => {
      void tick();
    }, tickMs);
    if (typeof timer.unref === 'function') {
      timer.unref();
    }
  }

  function stop(): void {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  return {
    triggerNow,
    triggerDue,
    nextRunAt,
    register,
    unregister,
    getNextRunAt,
    tick,
    start,
    stop
  };
}
