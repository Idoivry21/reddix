import type { NextFunction, Request, Response } from 'express';
import type { EventLogger } from './logger';

/**
 * State-mutating HTTP methods a cross-site page could use to drive the local
 * backend (CSRF / DNS-rebind). GET/HEAD/OPTIONS are safe or preflight-only.
 */
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * `Sec-Fetch-Site` values that indicate a request the user or the app itself
 * initiated. Modern browsers send this header on every request and page
 * JavaScript cannot forge it, so it closes the CORS "simple request" CSRF gap
 * that the origin allowlist alone cannot (a plain cross-origin form POST is not
 * preflighted, so CORS never blocks it before the handler runs).
 */
const SAME_SITE_FETCH_VALUES = new Set(['same-origin', 'none']);

/**
 * Returns true when a request is a cross-site, state-mutating call that should
 * be rejected. Requests without `Sec-Fetch-Site` (non-browser clients such as
 * curl, health checks, or older browsers) are allowed so local tooling keeps
 * working; the threat model here is a browser the user points at a malicious
 * page, and browsers always send the header.
 */
export function isCrossSiteMutation(method: string, secFetchSite: string | undefined): boolean {
  if (!MUTATING_METHODS.has(method.toUpperCase())) {
    return false;
  }

  return isCrossSiteBrowserRequest(secFetchSite);
}

export function isCrossSiteBrowserRequest(secFetchSite: string | undefined): boolean {
  if (!secFetchSite) {
    return false;
  }

  return !SAME_SITE_FETCH_VALUES.has(secFetchSite);
}

/**
 * Build the CSRF middleware that blocks cross-site state-mutating requests with
 * 403. Complements the CORS allowlist by stopping simple (non-preflighted) cross
 * origin requests that would otherwise reach the run/schedule handlers. When a
 * logger is supplied, rejections are logged with the offending Sec-Fetch-Site
 * value for security forensics; the value is never returned to the client.
 */
export function createCsrfGuard(logger?: EventLogger) {
  return function csrfGuard(req: Request, res: Response, next: NextFunction): void {
    const header = req.headers['sec-fetch-site'];
    const secFetchSite = Array.isArray(header) ? header[0] : header;

    if (isCrossSiteMutation(req.method, secFetchSite)) {
      logger?.warn('csrf.blocked', {
        method: req.method,
        path: req.path,
        secFetchSite: secFetchSite ?? 'missing'
      });
      res.status(403).json({
        error: 'Forbidden: cross-site request rejected',
        code: 'CROSS_SITE_BLOCKED'
      });
      return;
    }

    next();
  };
}

/** Default guard with no logger, for direct `app.use(csrfGuard)` and tests. */
export const csrfGuard = createCsrfGuard();
