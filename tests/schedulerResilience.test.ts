import { describe, expect, it, vi } from 'vitest';
import { createScheduler } from '../server/scheduler';
import { createMetrics } from '../server/metrics';

const MIN = 15 * 60 * 1000;

interface LogLine {
  level: string;
  message: string;
  fields: Record<string, unknown>;
}

function captureLogger() {
  const lines: LogLine[] = [];
  return {
    lines,
    logger: {
      info: (message: string, fields: Record<string, unknown> = {}) =>
        lines.push({ level: 'info', message, fields }),
      warn: (message: string, fields: Record<string, unknown> = {}) =>
        lines.push({ level: 'warn', message, fields }),
      error: (message: string, fields: Record<string, unknown> = {}) =>
        lines.push({ level: 'error', message, fields })
    }
  };
}

function fixedClock(start = 0) {
  let value = start;
  return { now: () => value, set: (ms: number) => (value = ms) };
}

describe('scheduler tick resilience (finding 1: must not crash the process)', () => {
  it('contains a rejecting runFlow inside tick(): tick resolves and logs the error', async () => {
    const clock = fixedClock(0);
    const { lines, logger } = captureLogger();
    const metrics = createMetrics();
    const scheduler = createScheduler({
      minIntervalMs: MIN,
      jitterMs: 0,
      now: clock.now,
      random: () => 0,
      logger,
      metrics,
      runFlow: async () => {
        throw new Error('disk full');
      },
      onSkip: async () => {}
    });
    scheduler.register('flow-1', { intervalMs: MIN, enabled: true, providers: [] });

    clock.set(MIN);
    // The whole point: this await must NOT reject (a rejection here would become
    // an unhandledRejection in the real `void tick()` and kill the server).
    await expect(scheduler.tick()).resolves.toBeUndefined();

    const tickError = lines.find((line) => line.message === 'schedule.tickError');
    expect(tickError?.level).toBe('error');
    expect(tickError?.fields.flowId).toBe('flow-1');
    expect(tickError?.fields.detail).toBe('disk full');
    expect(metrics.snapshot().counters['schedule_tick_errors_total']).toBe(1);
  });

  it('keeps processing later ticks after one fails', async () => {
    const clock = fixedClock(0);
    const { logger } = captureLogger();
    let attempts = 0;
    const scheduler = createScheduler({
      minIntervalMs: MIN,
      jitterMs: 0,
      now: clock.now,
      random: () => 0,
      logger,
      runFlow: async () => {
        attempts += 1;
        if (attempts === 1) {
          throw new Error('transient');
        }
      },
      onSkip: async () => {}
    });
    scheduler.register('flow-1', { intervalMs: MIN, enabled: true, providers: [] });

    clock.set(MIN);
    await scheduler.tick();
    clock.set(MIN * 2);
    await scheduler.tick();

    expect(attempts).toBe(2);
  });

  it('logs and counts skip + trigger lifecycle events', async () => {
    const { lines, logger } = captureLogger();
    const metrics = createMetrics();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const scheduler = createScheduler({
      minIntervalMs: MIN,
      jitterMs: 0,
      logger,
      metrics,
      runFlow: async () => {
        await gate;
      },
      onSkip: async () => {}
    });

    const first = scheduler.triggerNow('flow-1');
    await scheduler.triggerNow('flow-1'); // overlaps -> skipped
    release();
    await first;

    expect(lines.some((l) => l.message === 'schedule.triggered')).toBe(true);
    expect(lines.some((l) => l.message === 'schedule.skipped')).toBe(true);
    expect(metrics.snapshot().counters['schedule_triggered_total']).toBe(1);
    expect(metrics.snapshot().counters['schedule_skipped_total{reason=already-running}']).toBe(1);
  });
});
