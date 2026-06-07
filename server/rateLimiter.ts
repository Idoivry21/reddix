interface RateLimiterOptions {
  /** Minimum gap between two acquisitions for the same key. */
  minIntervalMs: number;
  /** How long an idle key is retained before pruning. Defaults to 2 windows. */
  ttlMs?: number;
  now?: () => number;
}

export interface RateLimiter {
  tryAcquire: (key: string) => boolean;
  readonly size: number;
}

/**
 * Minimum-gap rate limiter keyed by an arbitrary string (e.g. flow id). Guards
 * the subprocess-spawning /runs route from rapid repeated triggers.
 */
export function createRateLimiter(options: RateLimiterOptions): RateLimiter {
  const now = options.now ?? (() => Date.now());
  const ttlMs = options.ttlMs ?? Math.max(options.minIntervalMs * 2, 60_000);
  const lastAcquireAt = new Map<string, number>();

  return {
    tryAcquire(key: string): boolean {
      const at = now();
      pruneExpired(at);
      const previous = lastAcquireAt.get(key);
      if (previous !== undefined && at - previous < options.minIntervalMs) {
        return false;
      }
      lastAcquireAt.set(key, at);
      return true;
    },
    get size() {
      return lastAcquireAt.size;
    }
  };

  function pruneExpired(at: number): void {
    for (const [key, previous] of lastAcquireAt) {
      if (at - previous >= ttlMs) {
        lastAcquireAt.delete(key);
      }
    }
  }
}
