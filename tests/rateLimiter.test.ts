import { describe, expect, it } from 'vitest';
import { createRateLimiter } from '../server/rateLimiter';

describe('createRateLimiter', () => {
  it('allows the first acquire for a key', () => {
    let t = 1000;
    const limiter = createRateLimiter({ minIntervalMs: 2000, now: () => t });
    expect(limiter.tryAcquire('flow-1')).toBe(true);
  });

  it('blocks a second acquire within the window', () => {
    let t = 1000;
    const limiter = createRateLimiter({ minIntervalMs: 2000, now: () => t });
    expect(limiter.tryAcquire('flow-1')).toBe(true);
    t = 2500;
    expect(limiter.tryAcquire('flow-1')).toBe(false);
  });

  it('allows again once the window elapses', () => {
    let t = 1000;
    const limiter = createRateLimiter({ minIntervalMs: 2000, now: () => t });
    expect(limiter.tryAcquire('flow-1')).toBe(true);
    t = 3000;
    expect(limiter.tryAcquire('flow-1')).toBe(true);
  });

  it('tracks keys independently', () => {
    let t = 1000;
    const limiter = createRateLimiter({ minIntervalMs: 2000, now: () => t });
    expect(limiter.tryAcquire('a')).toBe(true);
    expect(limiter.tryAcquire('b')).toBe(true);
    expect(limiter.tryAcquire('a')).toBe(false);
  });

  it('hard-caps the tracked-key count under a flood of unique keys', () => {
    let t = 1000;
    // ttl long enough that pruning never fires within the test; only the maxKeys
    // backstop bounds growth.
    const limiter = createRateLimiter({ minIntervalMs: 100, ttlMs: 1_000_000, maxKeys: 3, now: () => t });

    for (let i = 0; i < 50; i += 1) {
      t += 1; // distinct instant per key so none are throttled
      expect(limiter.tryAcquire(`key-${i}`)).toBe(true);
    }

    expect(limiter.size).toBe(3);
  });

  it('evicts stale keys so long-running processes do not retain every flow id forever', () => {
    let t = 1000;
    const limiter = createRateLimiter({ minIntervalMs: 100, ttlMs: 500, now: () => t });

    expect(limiter.tryAcquire('old-flow')).toBe(true);
    t = 2000;
    expect(limiter.tryAcquire('new-flow')).toBe(true);

    expect(limiter.size).toBe(1);
  });
});
