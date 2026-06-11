import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('index.html security policy', () => {
  it('declares a restrictive CSP for the same-origin SPA shell', async () => {
    const html = await readFile('index.html', 'utf8');

    expect(html).toContain('http-equiv="Content-Security-Policy"');
    expect(html).toContain("script-src 'self'");
    expect(html).toContain("object-src 'none'");
    expect(html).toContain("base-uri 'none'");
    expect(html).toContain("form-action 'none'");
  });
});
