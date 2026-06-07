import type { SocialItem } from './types';

export function normalizeRedditPayload(payload: unknown, sourceBlockId: string): SocialItem[] {
  return extractArray(payload).map((raw) => {
    const title = stringValue(raw.title);
    const body = stringValue(raw.selftext ?? raw.body);
    return {
      platform: 'reddit',
      sourceBlockId,
      id: stringValue(raw.id) ?? stringValue(raw.name) ?? '',
      url: stringValue(raw.url) ?? permalinkToUrl(raw.permalink),
      author: stringValue(raw.author),
      community: stringValue(raw.subreddit),
      title,
      body,
      text: collapseText([title, body]),
      createdAt: toIsoDate(raw.created_utc ?? raw.createdAt ?? raw.created),
      engagement: {
        score: numberValue(raw.score),
        comments: numberValue(raw.num_comments ?? raw.comments)
      },
      media: extractMedia(raw),
      links: extractLinks(raw),
      raw
    };
  });
}

export function normalizeTwitterPayload(payload: unknown, sourceBlockId: string): SocialItem[] {
  return extractArray(payload).map((raw) => {
    const body = stringValue(raw.text ?? raw.full_text ?? raw.body);
    // twitter-cli nests counts under `metrics` and the author under `author.screenName`.
    // Keep flat fallbacks so older/alternate payload shapes still normalize.
    const metrics: RawRecord = isRecord(raw.metrics) ? raw.metrics : {};
    const handle = stringValue(
      raw.author?.screenName ?? raw.author?.handle ?? raw.author?.username ?? raw.username ?? raw.user
    );
    const id = stringValue(raw.id ?? raw.rest_id) ?? '';
    return {
      platform: 'twitter',
      sourceBlockId,
      id,
      // twitter-cli items carry no direct permalink; derive one from handle + id.
      url: stringValue(raw.url ?? raw.permalink) ?? tweetUrl(handle, id),
      author: handle,
      community: stringValue(raw.list ?? raw.community) ?? null,
      title: null,
      body,
      text: collapseText([body]),
      createdAt: toIsoDate(raw.createdAtISO ?? raw.created_at ?? raw.createdAt),
      engagement: {
        replies: numberValue(metrics.replies ?? raw.replies ?? raw.reply_count),
        likes: numberValue(metrics.likes ?? raw.likes ?? raw.favorite_count),
        retweets: numberValue(metrics.retweets ?? raw.retweets ?? raw.retweet_count),
        bookmarks: numberValue(metrics.bookmarks ?? raw.bookmarks ?? raw.bookmark_count),
        views: numberValue(metrics.views ?? raw.views ?? raw.view_count)
      },
      media: extractMedia(raw),
      links: extractLinks(raw),
      raw
    };
  });
}

function tweetUrl(handle: string | null, id: string): string | null {
  return handle && id ? `https://x.com/${handle}/status/${id}` : null;
}

type RawRecord = Record<string, any>;

function extractArray(payload: unknown): RawRecord[] {
  const value = payload as RawRecord;
  const data = value?.data ?? value?.items ?? value?.results ?? value;
  // CLIs wrap results as `{ ok, data: [...] }`; some commands nest one level
  // deeper (`data.posts` / `data.tweets`). Unwrap that level when present.
  const candidate =
    Array.isArray(data) || !isRecord(data)
      ? data
      : data.posts ?? data.tweets ?? data.results ?? data.items ?? data.children ?? data;
  if (Array.isArray(candidate)) {
    return candidate.filter(isRecord);
  }
  return isRecord(candidate) ? [candidate] : [];
}

function isRecord(value: unknown): value is RawRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function numberValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}

function toIsoDate(value: unknown): string {
  if (typeof value === 'number') {
    return safeIsoDate(new Date(value * 1000));
  }
  if (typeof value === 'string' && value.trim()) {
    return safeIsoDate(new Date(value));
  }
  return new Date(0).toISOString();
}

function safeIsoDate(date: Date): string {
  return Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString();
}

function collapseText(values: Array<string | null>): string {
  return values.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

function permalinkToUrl(value: unknown): string | null {
  const permalink = stringValue(value);
  if (!permalink) {
    return null;
  }
  return permalink.startsWith('http') ? permalink : `https://reddit.com${permalink}`;
}

function extractLinks(raw: RawRecord): string[] {
  const links = raw.links ?? raw.urls;
  if (Array.isArray(links)) {
    return links.filter((link): link is string => typeof link === 'string');
  }
  return [];
}

function extractMedia(raw: RawRecord): Array<{ type: string; url: string }> {
  const media = raw.media;
  if (!Array.isArray(media)) {
    return [];
  }
  return media
    .filter((entry) => isRecord(entry) && typeof entry.url === 'string')
    .map((entry) => ({ type: stringValue(entry.type) ?? 'unknown', url: entry.url }));
}
