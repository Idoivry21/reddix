/**
 * Outbound webhook delivery for the `output.webhook` block — the only place in
 * the app that opens a network socket to an arbitrary host. Every other block
 * spawns an allowlisted CLI or stays purely local, so this module is shaped to
 * contain that surface:
 *
 *  - HTTPS only (the spec's field `pattern` is enforced again here, defense in depth).
 *  - A per-request timeout bounds the call.
 *  - Every returned string masks the URL to its **origin** (scheme + host); the
 *    path and query are dropped, so a query-string token can never surface in a
 *    run record, the SSE stream, or a log (security invariant 2).
 *
 * No process is spawned (`executor.ts` is untouched) and no file is written
 * (it is a pure sink). The Authorization header — when a token is supplied — is
 * the only secret that leaves the process, and it never reaches a returned string.
 */

import { BlockList, isIP } from 'node:net';

/** Default per-request timeout. The CLIs' rate limiting does not apply (this is a
 *  third-party host, not `rdt`/`twitter`), so a hard timeout is the only bound. */
export const WEBHOOK_TIMEOUT_MS = 10_000;

/** Cap how much of the response body is drained. The body is never used
 *  downstream (only the status matters), so a hostile/oversized response can't
 *  balloon memory — we read at most this many bytes, then cancel the stream. */
const MAX_RESPONSE_BYTES = 64 * 1024;

export interface PostWebhookInput {
  url: string;
  /** Resolved env value, or null/empty for no `Authorization` header. */
  token?: string | null;
  /** The JSON envelope to POST. */
  body: unknown;
  timeoutMs?: number;
  /** Injectable for tests; defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
}

export interface WebhookResult {
  ok: boolean;
  /** HTTP status on a completed request; null on a network error / timeout. */
  statusCode: number | null;
  /** Human-readable failure reason (origin-masked), or null on success. */
  error: string | null;
  /** One-line `POST <origin> → <status>` for the run-step stdout summary. */
  summary: string;
}

/**
 * Reduce a URL to its origin (`scheme//host[:port]`), dropping path and query so
 * no embedded secret can leak into a persisted/broadcast string. Returns a fixed
 * sentinel for an unparseable URL rather than echoing the raw value.
 */
export function maskWebhookUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return '[invalid-url]';
  }
}

/**
 * Loopback / private / link-local / ULA / this-host ranges a webhook must never
 * reach. Built once at module load (SSRF egress guard, finding #2).
 */
const PRIVATE_RANGES = new BlockList();
PRIVATE_RANGES.addSubnet('0.0.0.0', 8, 'ipv4');
PRIVATE_RANGES.addSubnet('127.0.0.0', 8, 'ipv4');
PRIVATE_RANGES.addSubnet('10.0.0.0', 8, 'ipv4');
PRIVATE_RANGES.addSubnet('172.16.0.0', 12, 'ipv4');
PRIVATE_RANGES.addSubnet('192.168.0.0', 16, 'ipv4');
PRIVATE_RANGES.addSubnet('169.254.0.0', 16, 'ipv4');
PRIVATE_RANGES.addSubnet('::', 128, 'ipv6');
PRIVATE_RANGES.addSubnet('::1', 128, 'ipv6');
PRIVATE_RANGES.addSubnet('fe80::', 10, 'ipv6');
PRIVATE_RANGES.addSubnet('fc00::', 7, 'ipv6');

/**
 * True when a webhook destination is a loopback/private/link-local IP literal or
 * an obvious local hostname. This is a literal-IP + hostname denylist, NOT a
 * pre-fetch DNS resolution: a public hostname that resolves to a private IP at
 * connect time (DNS rebinding) is a documented residual, acceptable for a local
 * single-user tool. `redirect: 'error'` (below) keeps a public host from
 * 30x-redirecting egress inward.
 */
function isPrivateWebhookHost(parsed: URL): boolean {
  const host = parsed.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) {
    return true;
  }
  const family = isIP(host);
  if (family !== 0) {
    return PRIVATE_RANGES.check(host, family === 4 ? 'ipv4' : 'ipv6');
  }
  return false;
}

/**
 * POST the envelope to an HTTPS webhook endpoint. Never throws — a non-2xx
 * response, a network error, or a timeout all resolve to `{ ok: false, error }`
 * with the URL masked to its origin.
 */
export async function postWebhook(input: PostWebhookInput): Promise<WebhookResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const timeoutMs = input.timeoutMs ?? WEBHOOK_TIMEOUT_MS;
  const origin = maskWebhookUrl(input.url);

  let parsed: URL;
  try {
    parsed = new URL(input.url);
  } catch {
    return { ok: false, statusCode: null, error: 'Invalid webhook URL', summary: 'POST [invalid-url] → error' };
  }
  if (parsed.protocol !== 'https:') {
    return {
      ok: false,
      statusCode: null,
      error: `Refusing to POST to non-HTTPS URL ${origin}`,
      summary: `POST ${origin} → blocked`
    };
  }
  if (isPrivateWebhookHost(parsed)) {
    return {
      ok: false,
      statusCode: null,
      error: `Refusing to POST to private/loopback address ${origin}`,
      summary: `POST ${origin} → blocked`
    };
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (typeof input.token === 'string' && input.token.length > 0) {
    headers.Authorization = `Bearer ${input.token}`;
  }

  try {
    const response = await fetchImpl(input.url, {
      method: 'POST',
      headers,
      body: JSON.stringify(input.body),
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'error'
    });
    // Drain a bounded slice so the socket can be freed; the body is not used.
    await drainBody(response, MAX_RESPONSE_BYTES);
    const ok = response.status >= 200 && response.status <= 299;
    return {
      ok,
      statusCode: response.status,
      error: ok ? null : `POST ${origin} responded ${response.status}`,
      summary: `POST ${origin} → ${response.status}`
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    // Defense in depth: mask ANY url-like substring in the error to its origin —
    // regardless of normalization, casing, or trailing chars — so a fetch impl
    // that echoes the URL back can never leak the path or query into the result.
    const safeDetail = detail.replace(/https?:\/\/[^\s'"]+/gi, (match) => maskWebhookUrl(match));
    return {
      ok: false,
      statusCode: null,
      error: `POST ${origin} failed: ${safeDetail}`,
      summary: `POST ${origin} → error`
    };
  }
}

/**
 * Read at most `maxBytes` from a response body, then cancel the stream. Tolerant
 * of responses without a readable body (e.g. lightweight test mocks). Never
 * throws — draining must not turn a delivered POST into a failure.
 */
async function drainBody(response: { body?: unknown }, maxBytes: number): Promise<void> {
  const body = response.body as ReadableStream<Uint8Array> | null | undefined;
  if (!body || typeof body.getReader !== 'function') {
    return;
  }
  const reader = body.getReader();
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      total += value?.byteLength ?? 0;
      if (total >= maxBytes) {
        break;
      }
    }
  } catch {
    // Ignore body-read errors; the POST already completed.
  } finally {
    try {
      await reader.cancel();
    } catch {
      // Ignore cancel errors.
    }
  }
}
