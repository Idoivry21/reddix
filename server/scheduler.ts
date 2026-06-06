interface SchedulerOptions {
  minIntervalMs: number;
  jitterMs: number;
  runFlow: (flowId: string) => Promise<void>;
  onSkip: (flowId: string) => Promise<void>;
}

export function createScheduler(options: SchedulerOptions) {
  const running = new Set<string>();

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

  function nextRunAt(intervalMs: number, now = new Date()): Date {
    const safeInterval = Math.max(intervalMs, options.minIntervalMs);
    const jitter = options.jitterMs > 0 ? Math.floor(Math.random() * options.jitterMs) : 0;
    return new Date(now.getTime() + safeInterval + jitter);
  }

  return { triggerNow, nextRunAt };
}

