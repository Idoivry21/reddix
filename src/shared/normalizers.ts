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
    return {
      platform: 'twitter',
      sourceBlockId,
      id: stringValue(raw.id ?? raw.rest_id) ?? '',
      url: stringValue(raw.url ?? raw.permalink),
      author: stringValue(raw.author?.handle ?? raw.author?.username ?? raw.username ?? raw.user),
      community: stringValue(raw.list ?? raw.community) ?? null,
      title: null,
      body,
      text: collapseText([body]),
      createdAt: toIsoDate(raw.created_at ?? raw.createdAt),
      engagement: {
        replies: numberValue(raw.replies ?? raw.reply_count),
        likes: numberValue(raw.likes ?? raw.favorite_count),
        retweets: numberValue(raw.retweets ?? raw.retweet_count),
        bookmarks: numberValue(raw.bookmarks ?? raw.bookmark_count),
        views: numberValue(raw.views ?? raw.view_count)
      },
      media: extractMedia(raw),
      links: extractLinks(raw),
      raw
    };
  });
}

type RawRecord = Record<string, any>;

function extractArray(payload: unknown): RawRecord[] {
  const value = payload as RawRecord;
  const candidate = value?.data ?? value?.items ?? value?.results ?? value;
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
    return new Date(value * 1000).toISOString();
  }
  if (typeof value === 'string' && value.trim()) {
    return new Date(value).toISOString();
  }
  return new Date(0).toISOString();
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

