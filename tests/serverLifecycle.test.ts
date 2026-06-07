// @vitest-environment node

import http from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import { closeServer } from '../server/serverLifecycle';

describe('server lifecycle helpers', () => {
  it('completes shutdown even when a listen error fires before the server is listening', () => {
    const server = http.createServer();
    const done = vi.fn();

    expect(() => closeServer(server, done)).not.toThrow();

    expect(done).toHaveBeenCalledOnce();
  });
});
