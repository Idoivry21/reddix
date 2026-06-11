interface ScheduleRegistration {
  intervalMs: number;
  enabled: boolean;
  paused?: boolean;
  /** Providers this flow touches (e.g. ['reddit','twitter']) for spacing. */
  providers: string[];
}

import type { EventLogger } from './logger';
import { noopMetrics, type Metrics } from './metrics';

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
  onSkip: (flowId: string, reason?: string) => Promise<unknown>;
  now?: () => number;
  random?: () => number;
  logger?: EventLogger;
  metrics?: Metrics;
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
  const logger = options.logger;
  const metrics = options.metrics ?? noopMetrics;
  const providerSpacingMs = options.providerSpacingMs ?? DEFAULT_PROVIDER_SPACING_MS;
  const tickMs = options.tickMs ?? DEFAULT_TICK_MS;
  const maxConcurrentRuns = Math.max(1, Math.floor(options.maxConcurrentRuns ?? DEFAULT_MAX_CONCURRENT_RUNS));

  const running = new Set<string>();
  const schedules = new Map<string, ScheduleState>();
  const lastProviderFireAt = new Map<string, number>();
  const waiters: Array<() => void> = [];
  const drainWaiters: Array<() => void> = [];
  let activeRuns = 0;
  let timer: ReturnType<typeof setInterval> | null = null;
  let tickInFlight = false;
  // Set during graceful shutdown: rejects NEW runs and lets {@link drain} await the
  // in-flight ones so the process never kills a CLI child mid-run.
  let draining = false;

  function computeNextRunAt(intervalMs: number, from: number): number {
    const safeInterval = Math.max(intervalMs, options.minIntervalMs);
    const jitter = options.jitterMs > 0 ? Math.floor(random() * options.jitterMs) : 0;
    return from + safeInterval + jitter;
  }

  async function acquireRunSlot(): Promise<void> {
    if (activeRuns < maxConcurrentRuns) {
      activeRuns += 1;
      return;
    }
    await new Promise<void>((resolve) => waiters.push(resolve));
  }

  function releaseRunSlot(): void {
    // Hand the freed slot straight to the next waiter WITHOUT touching activeRuns:
    // a waiter took its slot via the wait path and never incremented the counter
    // itself, so the count is already correct for it. Only decrement when the
    // queue is empty and the slot truly frees up. This asymmetry is what keeps
    // activeRuns ≤ maxConcurrentRuns.
    const next = waiters.shift();
    if (next) {
      next();
      return;
    }
    activeRuns -= 1;
  }

  function settleDrainIfIdle(): void {
    if (draining && running.size === 0) {
      const waiting = drainWaiters.splice(0);
      for (const resolve of waiting) {
        resolve();
      }
    }
  }

  /**
   * Begin draining: reject NEW runs (via onSkip) and resolve once every in-flight
   * run has settled. Used by graceful shutdown so CLI children are never killed
   * out from under a running flow, and the run record persists before exit.
   */
  function drain(): Promise<void> {
    draining = true;
    if (running.size === 0) {
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => drainWaiters.push(resolve));
  }

  async function triggerNow(
    flowId: string,
    opts?: { providers?: string[]; enforceSpacing?: boolean }
  ): Promise<unknown> {
    if (draining) {
      logger?.info('schedule.skipped', { flowId, reason: 'draining' });
      metrics.increment('schedule_skipped_total', { reason: 'draining' });
      return options.onSkip(flowId, 'draining');
    }
    if (running.has(flowId)) {
      logger?.info('schedule.skipped', { flowId, reason: 'already-running' });
      metrics.increment('schedule_skipped_total', { reason: 'already-running' });
      return options.onSkip(flowId, 'already-running');
    }
    // Manual runs (POST /runs) opt into per-provider spacing so they cannot out-run
    // the CLIs' own throttling by bursting a provider faster than scheduled runs
    // would (security invariant 3). The scheduled path (triggerDue) already spaced
    // itself and does NOT pass enforceSpacing, so this branch is inert for it.
    // lastProviderFireAt is shared, so manual and scheduled runs mutually space.
    const providers = opts?.providers ?? [];
    if (opts?.enforceSpacing && providers.length > 0 && !isProviderSpaced(providers, now())) {
      logger?.info('schedule.skipped', { flowId, reason: 'provider-spacing' });
      metrics.increment('schedule_skipped_total', { reason: 'provider-spacing' });
      return options.onSkip(flowId, 'provider-spacing');
    }
    running.add(flowId);
    if (opts?.enforceSpacing) {
      const firedAt = now();
      for (const provider of providers) {
        lastProviderFireAt.set(provider, firedAt);
      }
    }
    await acquireRunSlot();
    logger?.info('schedule.triggered', { flowId });
    metrics.increment('schedule_triggered_total');
    try {
      return await options.runFlow(flowId);
    } finally {
      releaseRunSlot();
      running.delete(flowId);
      settleDrainIfIdle();
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
    if (draining || running.has(flowId)) {
      await triggerNow(flowId);
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

      let fired = 0;
      let deferred = 0;
      for (const [flowId, state] of due) {
        // Per-provider spacing: defer (do NOT advance next-run) so this flow is
        // retried on the next tick once the provider window clears.
        if (!isProviderSpaced(state.providers, at)) {
          deferred += 1;
          metrics.increment('schedule_deferred_total', { reason: 'provider-spacing' });
          logger?.info('schedule.deferred', { flowId, reason: 'provider-spacing' });
          continue;
        }
        // CRITICAL: a rejection here (e.g. a storage write error inside runFlow)
        // would otherwise propagate out of `void tick()` as an unhandled
        // rejection and crash the whole process. Contain it per-flow, log it,
        // and keep evaluating the remaining due flows.
        try {
          await triggerDue(flowId);
          fired += 1;
        } catch (error) {
          metrics.increment('schedule_tick_errors_total');
          logger?.error('schedule.tickError', {
            flowId,
            detail: error instanceof Error ? error.message : String(error)
          });
        }
      }
      if (due.length > 0) {
        logger?.info('schedule.tick', { dueCount: due.length, fired, deferred });
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
    register,
    unregister,
    getNextRunAt,
    tick,
    start,
    stop,
    drain
  };
}
