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
});
