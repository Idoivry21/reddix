import type { NextFunction, Request, Response } from 'express';
import type { EventLogger } from './logger';

/** Env-like object: only the keys we read are required, values may be undefined. */
type EnvLike = Record<string, string | undefined>;

/**
 * Comma-separated env var listing extra Host-header hostnames the backend accepts.
 * Setting it REPLACES the loopback defaults (opt-in widening for a named host).
 */
export const ALLOWED_HOSTS_ENV_KEY = 'REDDIX_ALLOWED_HOSTS';

/**
 * Hostnames the local single-user UX uses. The Host guard matches on the hostname
 * only (port stripped), since the bind port varies.
 */
export const DEFAULT_ALLOWED_HOST_NAMES = ['localhost', '127.0.0.1', '[::1]'] as const;

/**
 * Reduce a raw `Host` header to its lowercased hostname, dropping any `:port`.
 * A bracketed IPv6 literal (`[::1]:8787`) keeps its brackets. Returns null for a
 * missing/blank header — treated as allowed, matching the cors `!origin → true`
 * convention so non-browser clients and health checks keep working.
 */
export function parseHostHeader(hostHeader: string | undefined): string | null {
  if (!hostHeader) {
    return null;
  }
  const value = hostHeader.trim().toLowerCase();
  if (!value) {
    return null;
  }
  if (value.startsWith('[')) {
    const close = value.indexOf(']');
    return close >= 0 ? value.slice(0, close + 1) : value;
  }
  const colonCount = (value.match(/:/g) ?? []).length;
  if (colonCount > 1) {
    if (/^::1(?::\d+)?$/.test(value)) {
      return '[::1]';
    }
    return `[${value}]`;
  }
  const colon = value.indexOf(':');
  return colon >= 0 ? value.slice(0, colon) : value;
}

/**
 * Parse the allowlist from the environment. When `REDDIX_ALLOWED_HOSTS` is set
 * and non-blank, its entries (trimmed, port-stripped, lowercased, blanks dropped)
 * REPLACE the loopback defaults; otherwise the defaults are returned.
 */
export function parseAllowedHostNames(env: EnvLike): string[] {
  const raw = env[ALLOWED_HOSTS_ENV_KEY];
  const parsed = (raw ?? '')
    .split(',')
    .map((entry) => parseHostHeader(entry))
    .filter((entry): entry is string => entry !== null);
  return parsed.length > 0 ? parsed : [...DEFAULT_ALLOWED_HOST_NAMES];
}

/**
 * Whether a request's `Host` is permitted. A missing host is allowed; otherwise
 * the lowercased hostname must EXACTLY match an allowlisted name — no substring
 * or suffix matching, so `127.0.0.1.evil.example` is rejected.
 */
export function isAllowedHost(hostHeader: string | undefined, allowedHostNames: readonly string[]): boolean {
  const host = parseHostHeader(hostHeader);
  if (host === null) {
    return true;
  }
  return allowedHostNames.includes(host);
}

/**
 * Build the Host-header guard: reject a request whose `Host` is not loopback
 * (or an opted-in `REDDIX_ALLOWED_HOSTS` name) with 403. Defense-in-depth against
 * DNS-rebinding — the default `HOST=127.0.0.1` bind already blocks off-box
 * access; this matters when an operator binds `0.0.0.0` behind a named host.
 */
export function createHostGuard(env: EnvLike, logger?: EventLogger) {
  const allowedHostNames = parseAllowedHostNames(env);
  return function hostGuard(req: Request, res: Response, next: NextFunction): void {
    const header = req.headers.host;
    const hostHeader = Array.isArray(header) ? header[0] : header;
    if (!isAllowedHost(hostHeader, allowedHostNames)) {
      logger?.warn('host.blocked', {
        method: req.method,
        path: req.path,
        host: parseHostHeader(hostHeader) ?? 'missing'
      });
      res.status(403).json({ error: 'Forbidden: host not allowed', code: 'HOST_NOT_ALLOWED' });
      return;
    }
    next();
  };
}

/** Default guard from the process environment, for direct use and tests. */
export const hostGuard = createHostGuard(process.env);
