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
  /** How often the internal timer evaluates due flows. */
  tickMs?: number;
  runFlow: (flowId: string) => Promise<void>;
  onSkip: (flowId: string) => Promise<void>;
  now?: () => number;
  random?: () => number;
}

interface ScheduleState extends ScheduleRegistration {
  nextRunAt: number;
}

const DEFAULT_PROVIDER_SPACING_MS = 5_000;
const DEFAULT_TICK_MS = 30_000;

export function createScheduler(options: SchedulerOptions) {
  const now = options.now ?? (() => Date.now());
  const random = options.random ?? Math.random;
  const providerSpacingMs = options.providerSpacingMs ?? DEFAULT_PROVIDER_SPACING_MS;
  const tickMs = options.tickMs ?? DEFAULT_TICK_MS;

  const running = new Set<string>();
  const schedules = new Map<string, ScheduleState>();
  const lastProviderFireAt = new Map<string, number>();
  let timer: ReturnType<typeof setInterval> | null = null;

  function computeNextRunAt(intervalMs: number, from: number): number {
    const safeInterval = Math.max(intervalMs, options.minIntervalMs);
    const jitter = options.jitterMs > 0 ? Math.floor(random() * options.jitterMs) : 0;
    return from + safeInterval + jitter;
  }

  /** Legacy Date-returning helper retained for callers/tests. */
  function nextRunAt(intervalMs: number, fromDate = new Date(now())): Date {
    return new Date(computeNextRunAt(intervalMs, fromDate.getTime()));
  }

  async function triggerNow(flowId: string): Promise<void> {
    if (running.has(flowId)) {
      await options.onSkip(flowId);
      return;
    }
    running.add(flowId);
    try {
      await options.runFlow(flowId);
    } finally {
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

  function isProviderSpaced(providers: string[], at: number): boolean {
    return providers.every((provider) => {
      const last = lastProviderFireAt.get(provider);
      return last === undefined || at - last >= providerSpacingMs;
    });
  }

  async function tick(): Promise<void> {
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
      for (const provider of state.providers) {
        lastProviderFireAt.set(provider, at);
      }
      schedules.set(flowId, { ...state, nextRunAt: computeNextRunAt(state.intervalMs, at) });
      await triggerNow(flowId);
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
    nextRunAt,
    register,
    unregister,
    getNextRunAt,
    tick,
    start,
    stop
  };
}
