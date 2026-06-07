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
});
