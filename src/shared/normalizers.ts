import type { SocialItem } from './types';
import { coerceFiniteNumber, isRecord } from './values';

/**
 * Called when a CLI payload has content but no recognizable item array could be
 * extracted (e.g. the CLI changed its JSON envelope). Lets the run engine warn
 * so "0 results" caused by a shape change is distinguishable from a genuinely
 * empty result. Isomorphic: the shared core takes a callback, not a logger.
 */
export type UnrecognizedPayloadHandler = (info: { keys: string[] }) => void;

export function normalizeRedditPayload(
  payload: unknown,
  sourceBlockId: string,
  onUnrecognized?: UnrecognizedPayloadHandler
): SocialItem[] {
  return flattenRedditListings(extractArray(payload, onUnrecognized)).map((raw) => {
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

export function normalizeTwitterPayload(
  payload: unknown,
  sourceBlockId: string,
  onUnrecognized?: UnrecognizedPayloadHandler
): SocialItem[] {
  return extractArray(payload, onUnrecognized).map((raw) => {
    const body = stringValue(raw.text ?? raw.full_text ?? raw.body);
    // twitter-cli nests counts under `metrics` and the author under `author.screenName`.
    // Keep flat fallbacks so older/alternate payload shapes still normalize.
    const metrics: RawRecord = isRecord(raw.metrics) ? raw.metrics : {};
    const author: RawRecord = isRecord(raw.author) ? raw.author : {};
    const handle = stringValue(
      author.screenName ?? author.handle ?? author.username ?? raw.username ?? raw.user
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

type RawRecord = Record<string, unknown>;

function extractArray(payload: unknown, onUnrecognized?: UnrecognizedPayloadHandler): RawRecord[] {
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
  if (isRecord(candidate)) {
    return [candidate];
  }
  // No array and no single record could be extracted. If the payload carried
  // any content, the CLI's shape is unrecognized (likely an envelope change),
  // which would otherwise surface as a silent empty result.
  if (isRecord(value) && Object.keys(value).length > 0) {
    onUnrecognized?.({ keys: Object.keys(value) });
  }
  return [];
}

/**
 * Unwrap reddit's native Listing envelope. rdt's `--compact` commands (search,
 * browse, popular) return flat post objects, but `rdt read` has no compact mode
 * and emits reddit's raw shape: `data` is one or more
 * `{ kind:"Listing", data:{ children:[ { kind, data } ] } }` wrappers whose
 * children carry the post under `t3` and comments under `t1`. Flatten those to
 * the inner post objects, keeping only posts (`t3`) and dropping comment listings
 * (`t1`) and the `more` sentinel. Records that are already flat posts (compact
 * mode) carry no Listing wrapper and pass through unchanged.
 */
function flattenRedditListings(records: RawRecord[]): RawRecord[] {
  if (!records.some((record) => record.kind === 'Listing' || record.kind === 't3')) {
    return records;
  }
  const posts: RawRecord[] = [];
  for (const record of records) {
    if (record.kind === 'Listing' && isRecord(record.data)) {
      for (const child of listingChildren(record.data)) {
        if (child.kind === 't3' && isRecord(child.data)) {
          posts.push(child.data);
        }
      }
    } else if (record.kind === 't3' && isRecord(record.data)) {
      posts.push(record.data);
    } else {
      posts.push(record);
    }
  }
  return posts;
}

function listingChildren(listingData: RawRecord): RawRecord[] {
  const children = listingData.children;
  return Array.isArray(children) ? children.filter(isRecord) : [];
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

const numberValue = coerceFiniteNumber;

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
