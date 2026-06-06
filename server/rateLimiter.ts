interface RateLimiterOptions {
  /** Minimum gap between two acquisitions for the same key. */
  minIntervalMs: number;
  now?: () => number;
}

export interface RateLimiter {
  tryAcquire: (key: string) => boolean;
}

/**
 * Minimum-gap rate limiter keyed by an arbitrary string (e.g. flow id). Guards
 * the subprocess-spawning /runs route from rapid repeated triggers.
 */
export function createRateLimiter(options: RateLimiterOptions): RateLimiter {
  const now = options.now ?? (() => Date.now());
  const lastAcquireAt = new Map<string, number>();

  return {
    tryAcquire(key: string): boolean {
      const at = now();
      const previous = lastAcquireAt.get(key);
      if (previous !== undefined && at - previous < options.minIntervalMs) {
        return false;
      }
      lastAcquireAt.set(key, at);
      return true;
    }
  };
}
