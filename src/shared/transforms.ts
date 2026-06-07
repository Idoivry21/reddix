import type { SocialItem } from './types';

export function applyLimit(items: SocialItem[], settings: Record<string, unknown>): SocialItem[] {
  const limit = numberSetting(settings.limit, items.length);
  return items.slice(0, Math.max(0, limit));
}

export function applyFilterText(items: SocialItem[], settings: Record<string, unknown>): SocialItem[] {
  const include = stringSetting(settings.include).toLowerCase();
  const exclude = stringSetting(settings.exclude).toLowerCase();
  return items.filter((item) => {
    const haystack = [item.text, item.title, item.body, item.community, item.author, item.url]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    const includes = include ? haystack.includes(include) : true;
    const excludes = exclude ? haystack.includes(exclude) : false;
    return includes && !excludes;
  });
}

export function applyEngagementFilter(
  items: SocialItem[],
  settings: Record<string, unknown>
): SocialItem[] {
  const thresholds = {
    score: numberSetting(settings.minScore, 0),
    comments: numberSetting(settings.minComments, 0),
    replies: numberSetting(settings.minReplies, 0),
    likes: numberSetting(settings.minLikes, 0),
    retweets: numberSetting(settings.minRetweets, 0),
    bookmarks: numberSetting(settings.minBookmarks, 0),
    views: numberSetting(settings.minViews, 0)
  };

  return items.filter((item) => {
    return Object.entries(thresholds).every(([key, threshold]) => {
      if (threshold <= 0) {
        return true;
      }
      const value = item.engagement[key as keyof SocialItem['engagement']];
      return value == null ? true : value >= threshold;
    });
  });
}

/**
 * Sort items by the chosen field, descending (newest / highest first). Returns a
 * new array — the input is never mutated. Missing/non-numeric values sort last.
 */
export function applySort(items: SocialItem[], settings: Record<string, unknown>): SocialItem[] {
  const field = stringSetting(settings.field) || 'createdAt';
  return [...items].sort((a, b) => sortValue(b, field) - sortValue(a, field));
}

function sortValue(item: SocialItem, field: string): number {
  if (field === 'createdAt') {
    const time = Date.parse(item.createdAt);
    return Number.isNaN(time) ? 0 : time;
  }
  const value = item.engagement[field as keyof SocialItem['engagement']];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/**
 * Concatenate upstream streams and drop duplicate items (same platform + id),
 * keeping the first occurrence. The engine already flattens incoming edges into
 * one array, so this is the dedupe step that makes merging more than a no-op.
 */
export function applyMerge(items: SocialItem[]): SocialItem[] {
  const seen = new Set<string>();
  const merged: SocialItem[] = [];
  for (const item of items) {
    const key = `${item.platform}:${item.id}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    merged.push(item);
  }
  return merged;
}

function numberSetting(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return fallback;
}

function stringSetting(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

