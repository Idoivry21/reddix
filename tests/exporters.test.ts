import { describe, expect, it } from 'vitest';
import {
  buildTimestampedExportPath,
  serializeCsv,
  serializeJson,
  serializeMarkdown
} from '../src/shared/exporters';
import type { SocialItem } from '../src/shared/types';

const item: SocialItem = {
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
  links: ['https://example.com'],
  raw: { id: 'abc' }
};

describe('exporters', () => {
  it('serializes JSON with normalized items', () => {
    expect(serializeJson([item], true)).toContain('"platform": "reddit"');
  });

  it('omits the untrusted raw CLI payload from JSON exports', () => {
    const secretInRaw: SocialItem = {
      ...item,
      raw: { id: 'abc', echoed_token: 'TWITTER_AUTH_TOKEN_VALUE', headers: { auth: 'secret' } }
    };
    const json = serializeJson([secretInRaw], false);

    expect(json).not.toContain('raw');
    expect(json).not.toContain('echoed_token');
    expect(json).not.toContain('TWITTER_AUTH_TOKEN_VALUE');
    // Normalized fields still serialize.
    expect(JSON.parse(json)[0].id).toBe('abc');
    expect(JSON.parse(json)[0].raw).toBeUndefined();
  });

  it('serializes CSV with stable columns and escaping', () => {
    expect(serializeCsv([item])).toBe(
      'platform,id,createdAt,author,community,title,body,url,score,comments,replies,likes,retweets,bookmarks,views\nreddit,abc,2026-06-01T10:00:00.000Z,devops_dave,localdev,CLI tools,Automate local exports,https://reddit.com/r/localdev/comments/abc/test,42,7,,,,,\n'
    );
  });

  it('neutralizes spreadsheet formula cells in CSV exports', () => {
    const csv = serializeCsv([{ ...item, title: '=HYPERLINK("https://evil.example")', body: '+SUM(1,2)' }]);

    expect(csv).toContain('\'=HYPERLINK');
    expect(csv).toContain("\"'+SUM");
    expect(csv).not.toContain('\nreddit,abc,2026-06-01T10:00:00.000Z,devops_dave,localdev,=HYPERLINK');
  });

  it('neutralizes formula cells that lead with whitespace or a newline', () => {
    // Leading space: some importers trim then evaluate, re-exposing the formula.
    const leadingSpace = serializeCsv([{ ...item, title: ' =cmd|calc' }]);
    expect(leadingSpace).toContain("' =cmd|calc");
    // Leading newline: the cell is quoted AND prefixed, so it can't start a formula.
    const leadingNewline = serializeCsv([{ ...item, body: '\n=SUM(A1)' }]);
    expect(leadingNewline).toContain("\"'\n=SUM(A1)\"");
  });

  it('keeps finite negative numbers numeric in CSV exports', () => {
    const csv = serializeCsv([{ ...item, engagement: { ...item.engagement, score: -5 } }]);

    expect(csv).toContain(',https://reddit.com/r/localdev/comments/abc/test,-5,7,');
    expect(csv).not.toContain("'-5");
  });

  it('quotes cells containing a lone carriage return', () => {
    const csv = serializeCsv([{ ...item, title: 'old\rmac' }]);

    expect(csv).toContain('"old\rmac"');
  });

  it('serializes Markdown grouped by platform', () => {
    expect(serializeMarkdown([item])).toContain('## Reddit');
    expect(serializeMarkdown([item])).toContain('[CLI tools](<https://reddit.com/r/localdev/comments/abc/test>)');
  });

  it('drops dangerous Markdown links and escapes link labels', () => {
    const markdown = serializeMarkdown([
      {
        ...item,
        url: 'javascript:fetch("//evil.example")',
        title: 'break ](https://evil.example) [label]'
      }
    ]);

    expect(markdown).not.toContain('javascript:');
    expect(markdown).not.toContain('https://evil.example)');
    expect(markdown).toContain('break \\]\\(https://evil.example\\) \\[label\\]');
  });

  it('builds timestamped export paths to avoid overwrites', () => {
    expect(buildTimestampedExportPath('outputs/reddit.json', new Date('2026-06-01T10:11:12Z'))).toBe(
      'outputs/reddit-20260601-101112.json'
    );
  });

  it('includes a collision token in the filename when provided (finding #5)', () => {
    expect(buildTimestampedExportPath('outputs/reddit.json', new Date('2026-06-01T10:11:12Z'), 'ab12cd34-out1')).toBe(
      'outputs/reddit-20260601-101112-ab12cd34-out1.json'
    );
  });

  it('omits the token segment when none is given (back-compat)', () => {
    expect(buildTimestampedExportPath('outputs/reddit.json', new Date('2026-06-01T10:11:12Z'))).toBe(
      'outputs/reddit-20260601-101112.json'
    );
  });

  it('strips unsafe characters from the token so it cannot alter the path (finding #5)', () => {
    expect(buildTimestampedExportPath('a.json', new Date('2026-06-01T10:11:12Z'), '../../x')).toBe(
      'a-20260601-101112-x.json'
    );
  });
});
