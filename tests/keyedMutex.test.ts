import { describe, expect, it } from 'vitest';
import { createKeyedMutex } from '../server/keyedMutex';

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('createKeyedMutex', () => {
  it('serializes tasks sharing a key (no interleaving)', async () => {
    const mutex = createKeyedMutex();
    const events: string[] = [];

    const slow = mutex.run('a', async () => {
      events.push('start-1');
      await tick();
      await tick();
      events.push('end-1');
    });
    const fast = mutex.run('a', async () => {
      events.push('start-2');
      events.push('end-2');
    });

    await Promise.all([slow, fast]);
    expect(events).toEqual(['start-1', 'end-1', 'start-2', 'end-2']);
  });

  it('runs tasks with different keys concurrently', async () => {
    const mutex = createKeyedMutex();
    const events: string[] = [];

    const a = mutex.run('a', async () => {
      events.push('start-a');
      await tick();
      events.push('end-a');
    });
    const b = mutex.run('b', async () => {
      events.push('start-b');
      await tick();
      events.push('end-b');
    });

    await Promise.all([a, b]);
    // Both started before either finished -> interleaved start order.
    expect(events.slice(0, 2).sort()).toEqual(['start-a', 'start-b']);
  });

  it('keeps serializing after a task rejects', async () => {
    const mutex = createKeyedMutex();
    const events: string[] = [];

    const failing = mutex.run('a', async () => {
      events.push('fail');
      throw new Error('boom');
    });
    const next = mutex.run('a', async () => {
      events.push('after');
    });

    await expect(failing).rejects.toThrow('boom');
    await next;
    expect(events).toEqual(['fail', 'after']);
  });
});
