/**
 * Return `url` only when it parses as an `http:`/`https:` URL; otherwise null.
 * Blocks `javascript:`, `data:`, `vbscript:`, `mailto:`, and malformed values so
 * stored URLs cannot become XSS or phishing vectors when rendered as links.
 */
export function safeHref(url: unknown): string | null {
  if (typeof url !== 'string' || url.length === 0) {
    return null;
  }
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.href;
    }
    return null;
  } catch {
    return null;
  }
}
