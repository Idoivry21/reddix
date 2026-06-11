import { describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { csrfGuard, isCrossSiteMutation } from '../server/csrfGuard';

describe('isCrossSiteMutation', () => {
  it('blocks a cross-site state-mutating request', () => {
    expect(isCrossSiteMutation('POST', 'cross-site')).toBe(true);
    expect(isCrossSiteMutation('PUT', 'cross-site')).toBe(true);
    expect(isCrossSiteMutation('PATCH', 'cross-site')).toBe(true);
    expect(isCrossSiteMutation('DELETE', 'cross-site')).toBe(true);
  });

  it('blocks same-site (different origin, same registrable domain) mutations', () => {
    expect(isCrossSiteMutation('POST', 'same-site')).toBe(true);
  });

  it('allows same-origin and user-initiated (none) mutations', () => {
    expect(isCrossSiteMutation('POST', 'same-origin')).toBe(false);
    expect(isCrossSiteMutation('POST', 'none')).toBe(false);
  });

  it('allows mutations without the Sec-Fetch-Site header (curl / non-browser)', () => {
    expect(isCrossSiteMutation('POST', undefined)).toBe(false);
  });

  it('never blocks safe methods, even cross-site', () => {
    expect(isCrossSiteMutation('GET', 'cross-site')).toBe(false);
    expect(isCrossSiteMutation('HEAD', 'cross-site')).toBe(false);
    expect(isCrossSiteMutation('OPTIONS', 'cross-site')).toBe(false);
  });

  it('is case-insensitive on the method', () => {
    expect(isCrossSiteMutation('post', 'cross-site')).toBe(true);
  });
});

describe('csrfGuard middleware', () => {
  function run(method: string, secFetchSite: string | string[] | undefined) {
    const req = { method, headers: { 'sec-fetch-site': secFetchSite } } as unknown as Request;
    const json = vi.fn();
    const status = vi.fn().mockReturnValue({ json });
    const res = { status } as unknown as Response;
    const next = vi.fn() as unknown as NextFunction;
    csrfGuard(req, res, next);
    return { status, json, next };
  }

  it('rejects a cross-site POST with 403 and does not call next', () => {
    const { status, json, next } = run('POST', 'cross-site');
    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith({
      error: 'Forbidden: cross-site request rejected',
      code: 'CROSS_SITE_BLOCKED'
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('calls next for a same-origin POST', () => {
    const { status, next } = run('POST', 'same-origin');
    expect(status).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledOnce();
  });

  it('calls next for a cross-site GET', () => {
    const { status, next } = run('GET', 'cross-site');
    expect(status).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledOnce();
  });

  it('handles a duplicated Sec-Fetch-Site header array', () => {
    const { status, next } = run('POST', ['cross-site', 'same-origin']);
    expect(status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });
});
