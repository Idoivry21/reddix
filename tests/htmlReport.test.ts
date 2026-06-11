import { describe, expect, it } from 'vitest';
import { escapeHtml, safeHref, serializeHtml } from '../src/shared/htmlReport';
import type { SocialItem } from '../src/shared/types';

function makeItem(overrides: Partial<SocialItem> = {}): SocialItem {
  return {
    platform: 'reddit',
    sourceBlockId: 'search',
    id: 'abc',
    url: 'https://reddit.com/r/localdev/comments/abc/test',
    author: 'devops_dave',
    community: 'localdev',
    title: 'CLI tools',
    body: 'Automate local exports',
    text: 'CLI tools Automate local exports',
    createdAt: '2026-06-01T10:00:00.000Z',
    engagement: { score: 42, comments: 7 },
    media: [],
    links: [],
    raw: { id: 'abc' },
    ...overrides
  };
}

const meta = { flowName: 'Research Flow', generatedAt: '2026-06-07T12:00:00.000Z' };

describe('escapeHtml', () => {
  it('escapes the five HTML-significant characters', () => {
    expect(escapeHtml(`& < > " '`)).toBe('&amp; &lt; &gt; &quot; &#39;');
  });

  it('escapes ampersands before other entities (no double-encoding)', () => {
    expect(escapeHtml('<')).toBe('&lt;');
    expect(escapeHtml('a&b')).toBe('a&amp;b');
  });
});

describe('safeHref', () => {
  it('keeps http and https URLs', () => {
    expect(safeHref('https://example.com/x')).toBe('https://example.com/x');
    expect(safeHref('http://example.com')).toBe('http://example.com/');
  });

  it('drops javascript:, data:, and other dangerous schemes', () => {
    expect(safeHref('javascript:alert(1)')).toBeNull();
    expect(safeHref('data:text/html,<script>alert(1)</script>')).toBeNull();
    expect(safeHref('vbscript:msgbox(1)')).toBeNull();
    expect(safeHref('mailto:a@b.com')).toBeNull();
  });

  it('drops malformed and non-string values', () => {
    expect(safeHref('not a url')).toBeNull();
    expect(safeHref('')).toBeNull();
    expect(safeHref(null)).toBeNull();
    expect(safeHref(undefined)).toBeNull();
    expect(safeHref(42)).toBeNull();
  });
});

describe('serializeHtml', () => {
  it('produces a self-contained HTML document', () => {
    const html = serializeHtml([makeItem()], meta);
    expect(html.toLowerCase()).toContain('<!doctype html>');
    expect(html).toContain('<style>');
    expect(html).toContain('<script>');
    // self-contained: no external stylesheet/script references
    expect(html).not.toContain('<link rel="stylesheet"');
    expect(html).not.toMatch(/<script[^>]+src=/);
  });

  it('escapes untrusted title, body, author, and community', () => {
    const html = serializeHtml(
      [
        makeItem({
          title: '<script>alert(1)</script>',
          body: 'a"b\'c&d',
          author: '<img src=x onerror=alert(2)>',
          community: 'a<b>c'
        })
      ],
      meta
    );
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('<img src=x onerror=alert(2)>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('&quot;');
    expect(html).toContain('&#39;');
    expect(html).toContain('&amp;');
  });

  it('never embeds the raw payload', () => {
    const html = serializeHtml([makeItem({ raw: { secret: 'RAWSENTINEL12345' } })], meta);
    expect(html).not.toContain('RAWSENTINEL12345');
  });

  it('renders a safe http(s) original link and drops dangerous URLs', () => {
    const safe = serializeHtml([makeItem({ url: 'https://reddit.com/r/x/abc' })], meta);
    expect(safe).toContain('href="https://reddit.com/r/x/abc"');

    const hostile = serializeHtml([makeItem({ url: 'javascript:alert(1)' })], meta);
    expect(hostile).not.toContain('javascript:alert(1)');
    expect(hostile).not.toContain('href="javascript');
  });

  it('shows total count and per-platform breakdown in the header', () => {
    const html = serializeHtml(
      [
        makeItem({ id: 'r1', platform: 'reddit' }),
        makeItem({ id: 'r2', platform: 'reddit' }),
        makeItem({ id: 't1', platform: 'twitter', title: null, text: 'a tweet' })
      ],
      meta
    );
    expect(html).toContain('Research Flow');
    expect(html).toContain('data-total="3"');
    expect(html).toContain('data-reddit="2"');
    expect(html).toContain('data-twitter="1"');
  });

  it('renders reddit engagement (score, comments)', () => {
    const html = serializeHtml([makeItem({ platform: 'reddit', engagement: { score: 42, comments: 7 } })], meta);
    expect(html).toContain('↑');
    expect(html).toContain('42');
    expect(html).toContain('💬');
    expect(html).toContain('7');
  });

  it('renders x engagement (likes, retweets, views)', () => {
    const html = serializeHtml(
      [
        makeItem({
          platform: 'twitter',
          title: null,
          text: 'a tweet',
          engagement: { likes: 100, retweets: 5, views: 999 }
        })
      ],
      meta
    );
    expect(html).toContain('♥');
    expect(html).toContain('100');
    expect(html).toContain('🔁');
    expect(html).toContain('5');
    expect(html).toContain('👁');
    expect(html).toContain('999');
  });

  it('uses Twitter likes/views as the score sort value', () => {
    const html = serializeHtml(
      [
        makeItem({
          id: 't1',
          platform: 'twitter',
          title: null,
          text: 'liked tweet',
          engagement: { likes: 100, views: 2000 }
        }),
        makeItem({
          id: 't2',
          platform: 'twitter',
          title: null,
          text: 'viewed tweet',
          engagement: { views: 900 }
        })
      ],
      meta
    );

    expect(html).toContain('data-score="100"');
    expect(html).toContain('data-score="900"');
  });

  it('coerces non-numeric engagement to nothing rather than printing junk', () => {
    const html = serializeHtml(
      [makeItem({ engagement: { score: 'NaN' as unknown as number, comments: null } })],
      meta
    );
    expect(html).not.toContain('NaN');
  });

  it('formats large engagement counts without the 1000.0k rollover bug', () => {
    const html = serializeHtml(
      [makeItem({ platform: 'twitter', title: null, text: 't', engagement: { likes: 999999, retweets: 999950, views: 1234567 } })],
      meta
    );
    expect(html).not.toContain('1000.0k');
    expect(html).toContain('1.0M'); // 999999 and 999950 roll over to M
    expect(html).toContain('1.2M'); // 1234567
  });

  it('keeps counts just under the rollover in the k range', () => {
    const html = serializeHtml(
      [makeItem({ platform: 'twitter', title: null, text: 't', engagement: { likes: 999949, retweets: 1500, views: 999 } })],
      meta
    );
    expect(html).toContain('999.9k'); // 999949
    expect(html).toContain('1.5k'); // 1500
    expect(html).toContain('👁 999'); // small count unformatted
  });

  it('renders an image thumbnail only for safe image media', () => {
    const withImage = serializeHtml(
      [makeItem({ media: [{ type: 'image', url: 'https://img.example.com/a.png' }] })],
      meta
    );
    expect(withImage).toContain('src="https://img.example.com/a.png"');

    const hostileMedia = serializeHtml(
      [makeItem({ media: [{ type: 'image', url: 'javascript:alert(1)' }] })],
      meta
    );
    expect(hostileMedia).not.toContain('javascript:alert(1)');
  });

  it('renders a clean empty state for no items', () => {
    const html = serializeHtml([], meta);
    expect(html.toLowerCase()).toContain('<!doctype html>');
    expect(html).toContain('data-total="0"');
    expect(html.toLowerCase()).toMatch(/no items|no results/);
  });

  it('escapes the flow name and generated timestamp in the header', () => {
    const html = serializeHtml([], { flowName: '<b>x</b>', generatedAt: '2026-06-07T12:00:00.000Z' });
    expect(html).not.toContain('<b>x</b>');
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;');
  });
});
