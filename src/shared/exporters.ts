import { PROVIDER_META } from './providers';
import type { SocialItem } from './types';
import { safeHref } from './urlSafety';

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
  // Exports depend only on the normalized SocialItem shape. The untrusted `raw`
  // CLI payload is deliberately excluded: it would (a) let a token a hostile/buggy
  // CLI echoes back into its --json output land in a served artifact unredacted,
  // and (b) bloat exports with the entire upstream blob. CSV/Markdown already pull
  // only named fields; JSON is the only serializer that would otherwise emit `raw`.
  const exportItems = items.map(({ raw: _raw, ...rest }) => rest);
  return JSON.stringify(exportItems, null, pretty ? 2 : 0);
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
    // Use the canonical provider label so exports match the rest of the UI.
    const title = PROVIDER_META[platform as SocialItem['platform']]?.label ?? platform;
    const lines = groupItems.map((item) => {
      const label = escapeMarkdownLabel(item.title ?? item.body ?? item.id);
      const href = safeHref(item.url);
      const linked = href ? `[${label}](<${escapeMarkdownTarget(href)}>)` : label;
      return `- ${linked} — ${item.author ?? 'unknown author'}`;
    });
    return `## ${title}\n\n${lines.join('\n')}`;
  });
  return `# Social CLI Research Digest\n\n${sections.join('\n\n')}\n`;
}

function escapeMarkdownLabel(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/([\[\]()])/g, '\\$1').replace(/\r?\n/g, ' ');
}

function escapeMarkdownTarget(value: string): string {
  return value.replace(/>/g, '%3E');
}

export function buildTimestampedExportPath(filePath: string, date: Date, token?: string): string {
  const timestamp = date
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, '')
    .replace('T', '-');
  // Optional per-write collision token (runId + blockId) so two output nodes or
  // two runs that resolve to the same path within one second cannot overwrite
  // each other (finding #5). Sanitized to a filename-safe charset so it can never
  // introduce a slash/dot and alter the path. Absent token → byte-identical name.
  const suffix = token ? `-${token.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 24)}` : '';
  // Parse the POSIX-style export path with string ops only, so this module stays
  // browser-safe (no node:path) and honors the isomorphic src/shared contract.
  const slash = filePath.lastIndexOf('/');
  const dir = slash >= 0 ? filePath.slice(0, slash + 1) : '';
  const base = filePath.slice(slash + 1);
  const dot = base.lastIndexOf('.');
  // dot > 0 so a leading-dot dotfile (".env") is treated as having no extension.
  const name = dot > 0 ? base.slice(0, dot) : base;
  const ext = dot > 0 ? base.slice(dot) : '';
  return `${dir}${name}-${timestamp}${suffix}${ext}`;
}

function csvCell(value: unknown): string {
  if (value === undefined || value === null) {
    return '';
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  const raw = String(value);
  // CSV formula-injection guard: spreadsheets (Excel/Sheets) execute a cell that
  // begins with = + - @ (or a tab/CR variant). A leading space or newline is also
  // dangerous: some importers trim/normalize leading whitespace before evaluating,
  // re-exposing a formula like " =cmd". Prefix any such cell with ' to neutralize.
  const text = /^[=+\-@\t\r\n ]/.test(raw) ? `'${raw}` : raw;
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}
