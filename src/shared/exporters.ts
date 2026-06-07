import type { SocialItem } from './types';

const csvColumns = [
  'platform',
  'id',
  'createdAt',
  'author',
  'community',
  'title',
  'body',
  'url',
  'score',
  'comments',
  'replies',
  'likes',
  'retweets',
  'bookmarks',
  'views'
] as const;

export function serializeJson(items: SocialItem[], pretty: boolean): string {
  return JSON.stringify(items, null, pretty ? 2 : 0);
}

export function serializeCsv(items: SocialItem[]): string {
  const rows = items.map((item) =>
    [
      item.platform,
      item.id,
      item.createdAt,
      item.author,
      item.community,
      item.title,
      item.body,
      item.url,
      item.engagement.score,
      item.engagement.comments,
      item.engagement.replies,
      item.engagement.likes,
      item.engagement.retweets,
      item.engagement.bookmarks,
      item.engagement.views
    ]
      .map(csvCell)
      .join(',')
  );
  return `${csvColumns.join(',')}\n${rows.join('\n')}${rows.length ? '\n' : ''}`;
}

export function serializeMarkdown(items: SocialItem[]): string {
  const groups = new Map<string, SocialItem[]>();
  for (const item of items) {
    groups.set(item.platform, [...(groups.get(item.platform) ?? []), item]);
  }

  const sections = Array.from(groups.entries()).map(([platform, groupItems]) => {
    const title = platform === 'reddit' ? 'Reddit' : 'X/Twitter';
    const lines = groupItems.map((item) => {
      const label = item.title ?? item.body ?? item.id;
      const linked = item.url ? `[${label}](${item.url})` : label;
      return `- ${linked} — ${item.author ?? 'unknown author'}`;
    });
    return `## ${title}\n\n${lines.join('\n')}`;
  });
  return `# Social CLI Research Digest\n\n${sections.join('\n\n')}\n`;
}

export function buildTimestampedExportPath(filePath: string, date: Date): string {
  const timestamp = date
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, '')
    .replace('T', '-');
  // Parse the POSIX-style export path with string ops only, so this module stays
  // browser-safe (no node:path) and honors the isomorphic src/shared contract.
  const slash = filePath.lastIndexOf('/');
  const dir = slash >= 0 ? filePath.slice(0, slash + 1) : '';
  const base = filePath.slice(slash + 1);
  const dot = base.lastIndexOf('.');
  // dot > 0 so a leading-dot dotfile (".env") is treated as having no extension.
  const name = dot > 0 ? base.slice(0, dot) : base;
  const ext = dot > 0 ? base.slice(dot) : '';
  return `${dir}${name}-${timestamp}${ext}`;
}

function csvCell(value: unknown): string {
  if (value === undefined || value === null) {
    return '';
  }
  const raw = String(value);
  const text = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}
