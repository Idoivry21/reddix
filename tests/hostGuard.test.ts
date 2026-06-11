import type { NextFunction, Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import {
  createHostGuard,
  DEFAULT_ALLOWED_HOST_NAMES,
  isAllowedHost,
  parseAllowedHostNames,
  parseHostHeader
} from '../server/hostGuard';

describe('parseHostHeader', () => {
  it('strips the port and lowercases the hostname', () => {
    expect(parseHostHeader('localhost:5173')).toBe('localhost');
    expect(parseHostHeader('127.0.0.1:8787')).toBe('127.0.0.1');
    expect(parseHostHeader('LOCALHOST')).toBe('localhost');
  });

  it('preserves a bracketed IPv6 literal', () => {
    expect(parseHostHeader('[::1]:8787')).toBe('[::1]');
  });

  it('normalizes unbracketed IPv6 loopback so it can match the allowlist', () => {
    expect(parseHostHeader('::1')).toBe('[::1]');
    expect(parseHostHeader('::1:8787')).toBe('[::1]');
  });

  it('returns null for a missing or blank header', () => {
    expect(parseHostHeader(undefined)).toBeNull();
    expect(parseHostHeader('')).toBeNull();
  });
});

describe('parseAllowedHostNames', () => {
  it('defaults to the loopback host names when unset or blank', () => {
    expect(parseAllowedHostNames({})).toEqual([...DEFAULT_ALLOWED_HOST_NAMES]);
    expect(parseAllowedHostNames({ REDDIX_ALLOWED_HOSTS: '   ' })).toEqual([...DEFAULT_ALLOWED_HOST_NAMES]);
  });

  it('replaces defaults with the trimmed, port-stripped, lowercased env list', () => {
    expect(parseAllowedHostNames({ REDDIX_ALLOWED_HOSTS: 'myhost.local:8787 , , Other.Host' })).toEqual([
      'myhost.local',
      'other.host'
    ]);
  });
});

describe('isAllowedHost', () => {
  const allowed = [...DEFAULT_ALLOWED_HOST_NAMES];

  it('allows each default loopback name and a missing host', () => {
    expect(isAllowedHost('localhost:5173', allowed)).toBe(true);
    expect(isAllowedHost('127.0.0.1:8787', allowed)).toBe(true);
    expect(isAllowedHost('[::1]:8787', allowed)).toBe(true);
    expect(isAllowedHost('::1', allowed)).toBe(true);
    expect(isAllowedHost(undefined, allowed)).toBe(true);
  });

  it('rejects a foreign host and a substring/suffix spoof (exact match only)', () => {
    expect(isAllowedHost('evil.example', allowed)).toBe(false);
    expect(isAllowedHost('127.0.0.1.evil.example', allowed)).toBe(false);
  });
});

function run(headers: Record<string, string | string[] | undefined>, env: Record<string, string | undefined> = {}) {
  const req = { headers, method: 'GET', path: '/api/flows/x' } as unknown as Request;
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    status: vi.fn(function (this: { statusCode: number }, code: number) {
      this.statusCode = code;
      return this;
    }),
    json: vi.fn(function (this: { body: unknown }, body: unknown) {
      this.body = body;
      return this;
    })
  };
  const next = vi.fn() as unknown as NextFunction;
  createHostGuard(env)(req, res as unknown as Response, next);
  return { res, next };
}

describe('createHostGuard middleware', () => {
  it('rejects a foreign Host with 403 and does not call next', () => {
    const { res, next } = run({ host: 'evil.example' });
    expect(res.status).toHaveBeenCalledWith(403);
    expect((res as unknown as { body: unknown }).body).toMatchObject({ code: 'HOST_NOT_ALLOWED' });
    expect(next).not.toHaveBeenCalled();
  });

  it('allows loopback hosts through', () => {
    expect(run({ host: 'localhost:5173' }).next).toHaveBeenCalledTimes(1);
    expect(run({ host: '127.0.0.1:8787' }).next).toHaveBeenCalledTimes(1);
  });

  it('allows a request with no Host header (local tooling)', () => {
    expect(run({}).next).toHaveBeenCalledTimes(1);
  });

  it('uses the first value of a duplicated Host header and rejects a foreign one', () => {
    const { next } = run({ host: ['evil.example', 'localhost'] });
    expect(next).not.toHaveBeenCalled();
  });
});
