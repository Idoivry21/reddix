import { describe, expect, it, vi } from 'vitest';
import { createScheduler } from '../server/scheduler';

describe('scheduler', () => {
  it('skips overlapping runs for the same flow and records the skip', async () => {
    let release!: () => void;
    const firstRun = new Promise<void>((resolve) => {
      release = resolve;
    });
    const skipped: string[] = [];
    const scheduler = createScheduler({
      minIntervalMs: 15 * 60 * 1000,
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
});

