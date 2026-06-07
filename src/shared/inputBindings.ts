import type { SocialItem } from './types';
import { isBlank } from './values';

interface InputBinding {
  fieldKey: string;
  label: string;
  /** Human label of the upstream SocialItem field this pulls from, for the
   * Inspector mapper row (e.g. 'id', 'id or url', 'author'). UI-only — the
   * {@link InputBinding.select} function stays the single source of resolution truth. */
  sourceLabel: string;
  select: (item: SocialItem) => string | null | undefined;
}

const inputBindings: Record<string, InputBinding[]> = {
  'reddit.readPost': [
    {
      fieldKey: 'postId',
      label: 'Post ID',
      sourceLabel: 'id',
      select: (item) => (item.platform === 'reddit' ? item.id : null)
    }
  ],
  'twitter.tweetDetail': [
    {
      fieldKey: 'tweetIdOrUrl',
      label: 'Tweet ID or URL',
      sourceLabel: 'id or url',
      select: (item) => (item.platform === 'twitter' ? item.id || item.url : null)
    }
  ],
  'twitter.userProfile': [
    {
      fieldKey: 'handle',
      label: 'Handle',
      sourceLabel: 'author',
      select: (item) => (item.platform === 'twitter' ? item.author : null)
    }
  ]
};

/** UI-facing description of a block's input binding: which field is filled from
 *  which upstream source. Lets the Inspector render the mapper without touching
 *  the selector closures. */
export interface InputBindingMeta {
  fieldKey: string;
  label: string;
  sourceLabel: string;
}

export function inputBoundFieldKeys(blockType: string): string[] {
  return (inputBindings[blockType] ?? []).map((binding) => binding.fieldKey);
}

export function inputBindingMeta(blockType: string): InputBindingMeta[] {
  return (inputBindings[blockType] ?? []).map(({ fieldKey, label, sourceLabel }) => ({
    fieldKey,
    label,
    sourceLabel
  }));
}

/**
 * The bound field keys that are currently blank — the fields that will be filled
 * from upstream output at run time. A non-empty result is the signal that a wired
 * enrichment block should fan out (one CLI call per upstream item) rather than run
 * a single command.
 */
export function blankBoundFieldKeys(blockType: string, settings: Record<string, unknown>): string[] {
  return (inputBindings[blockType] ?? [])
    .filter((binding) => isBlank(settings[binding.fieldKey]))
    .map((binding) => binding.fieldKey);
}

/**
 * Resolve a block's input-bound fields from a SINGLE upstream item (the per-item
 * counterpart to {@link resolveInputBoundSettings}, which scans the whole input
 * array and uses the first match). Returns new settings with every blank bound
 * field filled from this item, or `null` when the item cannot supply a required
 * value (e.g. a Reddit item feeding a Twitter block) so the caller can skip it
 * instead of failing the whole node. Fields with a static value are left intact.
 */
export function resolveInputBoundSettingsForItem(
  blockType: string,
  settings: Record<string, unknown>,
  item: SocialItem
): Record<string, unknown> | null {
  const bindings = inputBindings[blockType] ?? [];
  if (bindings.length === 0) {
    return settings;
  }

  let resolved = settings;
  for (const binding of bindings) {
    if (!isBlank(settings[binding.fieldKey])) {
      continue;
    }
    const value = binding.select(item);
    if (typeof value !== 'string' || !value.trim()) {
      return null;
    }
    if (resolved === settings) {
      resolved = { ...settings };
    }
    resolved[binding.fieldKey] = value.trim();
  }
  return resolved;
}

export function resolveInputBoundSettings(
  blockType: string,
  settings: Record<string, unknown>,
  inputItems: SocialItem[]
): Record<string, unknown> {
  const bindings = inputBindings[blockType] ?? [];
  if (bindings.length === 0) {
    return settings;
  }

  let resolved = settings;
  for (const binding of bindings) {
    if (!isBlank(settings[binding.fieldKey])) {
      continue;
    }
    const value = firstInputValue(inputItems, binding);
    if (!value) {
      throw new Error(`${binding.label} could not be resolved from upstream output`);
    }
    if (resolved === settings) {
      resolved = { ...settings };
    }
    resolved[binding.fieldKey] = value;
  }
  return resolved;
}

function firstInputValue(items: SocialItem[], binding: InputBinding): string | null {
  for (const item of items) {
    const value = binding.select(item);
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return null;
}
