import { describe, expect, it, vi } from 'vitest';
import { createScheduler } from '../server/scheduler';

const MIN = 15 * 60 * 1000;

function fixedClock(start = 0) {
  let value = start;
  return {
    now: () => value,
    advance: (ms: number) => {
      value += ms;
    },
    set: (ms: number) => {
      value = ms;
    }
  };
}

describe('scheduler single-flight', () => {
  it('skips overlapping runs for the same flow and records the skip', async () => {
    let release!: () => void;
    const firstRun = new Promise<void>((resolve) => {
      release = resolve;
    });
    const skipped: string[] = [];
    const scheduler = createScheduler({
      minIntervalMs: MIN,
      jitterMs: 0,
      onSkip: async (flowId) => {
        skipped.push(flowId);
      },
      runFlow: vi.fn(async () => {
        await firstRun;
      })
    });

    const first = scheduler.triggerNow('flow-1');
    await scheduler.triggerNow('flow-1');
    release();
    await first;

    expect(skipped).toEqual(['flow-1']);
  });

  it('caps concurrent runs across different flows', async () => {
    let active = 0;
    let maxActive = 0;
    const releases: Array<() => void> = [];
    const scheduler = createScheduler({
      minIntervalMs: MIN,
      jitterMs: 0,
      maxConcurrentRuns: 1,
      onSkip: async () => {},
      runFlow: async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise<void>((resolve) => releases.push(resolve));
        active -= 1;
      }
    });

    const first = scheduler.triggerNow('flow-1');
    const second = scheduler.triggerNow('flow-2');
    await vi.waitFor(() => expect(releases).toHaveLength(1));
    releases.shift()?.();
    await vi.waitFor(() => expect(releases).toHaveLength(1));
    releases.shift()?.();
    await Promise.all([first, second]);

    expect(maxActive).toBe(1);
  });
});

describe('scheduler due calculation', () => {
  it('fires a registered flow only once its next-run time is reached', async () => {
    const clock = fixedClock(0);
    const runFlow = vi.fn(async () => {});
    const scheduler = createScheduler({
      minIntervalMs: MIN,
      jitterMs: 0,
      now: clock.now,
      random: () => 0,
      runFlow,
      onSkip: async () => {}
    });

    scheduler.register('flow-1', { intervalMs: MIN, enabled: true, providers: ['reddit'] });

    clock.set(MIN - 1);
    await scheduler.tick();
    expect(runFlow).not.toHaveBeenCalled();

    clock.set(MIN);
    await scheduler.tick();
    expect(runFlow).toHaveBeenCalledTimes(1);

    // Same instant again -> next-run advanced, not due.
    await scheduler.tick();
    expect(runFlow).toHaveBeenCalledTimes(1);

    clock.advance(MIN);
    await scheduler.tick();
    expect(runFlow).toHaveBeenCalledTimes(2);
  });

  it('supports due-only manual triggering for scheduled flows', async () => {
    const clock = fixedClock(0);
    const runFlow = vi.fn(async () => 'ran');
    const scheduler = createScheduler({
      minIntervalMs: MIN,
      jitterMs: 0,
      now: clock.now,
      random: () => 0,
      runFlow,
      onSkip: async () => 'skipped'
    });

    scheduler.register('flow-1', { intervalMs: MIN, enabled: true, providers: [] });

    expect(await scheduler.triggerDue('flow-1')).toEqual({ triggered: false, nextRunAt: MIN });
    expect(runFlow).not.toHaveBeenCalled();

    clock.set(MIN);
    expect(await scheduler.triggerDue('flow-1')).toEqual({
      triggered: true,
      result: 'ran',
      nextRunAt: MIN * 2
    });
  });

  it('does not fire paused or disabled schedules', async () => {
    const clock = fixedClock(0);
    const runFlow = vi.fn(async () => {});
    const scheduler = createScheduler({
      minIntervalMs: MIN,
      jitterMs: 0,
      now: clock.now,
      random: () => 0,
      runFlow,
      onSkip: async () => {}
    });

    scheduler.register('paused', { intervalMs: MIN, enabled: true, paused: true, providers: [] });
    scheduler.register('disabled', { intervalMs: MIN, enabled: false, providers: [] });

    clock.set(MIN * 2);
    await scheduler.tick();
    expect(runFlow).not.toHaveBeenCalled();
  });
});

describe('scheduler per-provider spacing', () => {
  it('defers a same-provider flow to a later tick instead of firing together', async () => {
    const clock = fixedClock(0);
    const fired: string[] = [];
    const scheduler = createScheduler({
      minIntervalMs: MIN,
      jitterMs: 0,
      providerSpacingMs: 60 * 1000,
      now: clock.now,
      random: () => 0,
      runFlow: async (flowId) => {
        fired.push(flowId);
      },
      onSkip: async () => {}
    });

    scheduler.register('a', { intervalMs: MIN, enabled: true, providers: ['reddit'] });
    scheduler.register('b', { intervalMs: MIN, enabled: true, providers: ['reddit'] });

    clock.set(MIN);
    await scheduler.tick();
    // Only one reddit flow fires this tick.
    expect(fired).toHaveLength(1);

    // After the spacing window the deferred flow fires.
    clock.advance(60 * 1000);
    await scheduler.tick();
    expect(fired).toHaveLength(2);
    expect(new Set(fired)).toEqual(new Set(['a', 'b']));
  });

  it('lets flows on different providers fire in the same tick', async () => {
    const clock = fixedClock(0);
    const fired: string[] = [];
    const scheduler = createScheduler({
      minIntervalMs: MIN,
      jitterMs: 0,
      providerSpacingMs: 60 * 1000,
      now: clock.now,
      random: () => 0,
      runFlow: async (flowId) => {
        fired.push(flowId);
      },
      onSkip: async () => {}
    });

    scheduler.register('r', { intervalMs: MIN, enabled: true, providers: ['reddit'] });
    scheduler.register('t', { intervalMs: MIN, enabled: true, providers: ['twitter'] });

    clock.set(MIN);
    await scheduler.tick();
    expect(new Set(fired)).toEqual(new Set(['r', 't']));
  });
});
