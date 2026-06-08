import { getBlockSpec } from './commandBuilders';
import { getSocialItemField } from './fieldSchema';
import type { SocialItem } from './types';
import { isBlank, isRecord } from './values';

/**
 * A block field that is filled from upstream output by default — the three
 * built-in enrichment bindings (Read Post, Tweet Detail, User Profile). These
 * are the *defaults*: a user can override any of them, or bind any other field,
 * via the explicit `__bindings` map (see {@link readBindings}). Resolution
 * always routes through the generic {@link getSocialItemField} accessor.
 */
interface DefaultBinding {
  fieldKey: string;
  label: string;
  /** UI label of the upstream field the default pulls from (Inspector mapper). */
  sourceLabel: string;
  /** The upstream {@link getSocialItemField} key this default reads. */
  defaultSourceKey: string;
  /** Tried when {@link defaultSourceKey} yields nothing (e.g. tweet id → url). */
  fallbackSourceKey?: string;
  /** Items of another platform cannot drive the block — resolution returns null. */
  platform?: SocialItem['platform'];
}

const defaultBindings: Record<string, DefaultBinding[]> = {
  'reddit.readPost': [
    { fieldKey: 'postId', label: 'Post ID', sourceLabel: 'id', defaultSourceKey: 'id', platform: 'reddit' }
  ],
  'twitter.tweetDetail': [
    {
      fieldKey: 'tweetIdOrUrl',
      label: 'Tweet ID or URL',
      sourceLabel: 'id or url',
      defaultSourceKey: 'id',
      fallbackSourceKey: 'url',
      platform: 'twitter'
    }
  ],
  'twitter.userProfile': [
    { fieldKey: 'handle', label: 'Handle', sourceLabel: 'author', defaultSourceKey: 'author', platform: 'twitter' }
  ]
};

/** UI-facing description of one binding for the Inspector mapper. */
export interface InputBindingMeta {
  fieldKey: string;
  label: string;
  sourceLabel: string;
}

/**
 * The user-defined field bindings stored on a node under the reserved
 * `__bindings` settings key: `{ downstreamFieldKey: upstreamFieldKey }`. Parsed
 * defensively (it is untrusted persisted data) the same way `__bindPolicy` is.
 */
export function readBindings(settings: Record<string, unknown>): Record<string, string> {
  const raw = (settings as { __bindings?: unknown }).__bindings;
  if (!isRecord(raw)) {
    return {};
  }
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === 'string' && value) {
      out[key] = value;
    }
  }
  return out;
}

/** The default-bound field keys for a block (legacy 3-block set). */
export function inputBoundFieldKeys(blockType: string): string[] {
  return (defaultBindings[blockType] ?? []).map((binding) => binding.fieldKey);
}

/** Legacy mapper metadata (default bindings only) for the Inspector. */
export function inputBindingMeta(blockType: string): InputBindingMeta[] {
  return (defaultBindings[blockType] ?? []).map(({ fieldKey, label, sourceLabel }) => ({
    fieldKey,
    label,
    sourceLabel
  }));
}

/**
 * Every field bound for this node: the block's default-bound keys unioned with
 * the user's explicit `__bindings` keys (defaults first, deduped). This is the
 * generalized successor to {@link inputBoundFieldKeys} and is what validation and
 * fan-out reason about.
 */
export function boundFieldKeys(blockType: string, settings: Record<string, unknown>): string[] {
  const keys = inputBoundFieldKeys(blockType);
  const seen = new Set(keys);
  for (const key of Object.keys(readBindings(settings))) {
    if (!seen.has(key)) {
      seen.add(key);
      keys.push(key);
    }
  }
  return keys;
}

/**
 * The bound field keys that are currently blank — the fields that will be filled
 * from upstream output at run time. A non-empty result is the signal that a wired
 * block should fan out (one CLI call per upstream item) rather than run a single
 * command.
 */
export function blankBoundFieldKeys(blockType: string, settings: Record<string, unknown>): string[] {
  return boundFieldKeys(blockType, settings).filter((fieldKey) => isBlank(settings[fieldKey]));
}

/**
 * Resolve one field's value from a single upstream item. A user binding wins;
 * otherwise the block's default binding applies (with its platform guard and
 * optional fallback). Returns null when the item cannot supply the value.
 */
function resolveFieldFromItem(
  blockType: string,
  fieldKey: string,
  userBindings: Record<string, string>,
  item: SocialItem
): string | null {
  const userKey = userBindings[fieldKey];
  if (userKey) {
    return getSocialItemField(item, userKey);
  }
  const binding = defaultBindings[blockType]?.find((entry) => entry.fieldKey === fieldKey);
  if (!binding) {
    return null;
  }
  if (binding.platform && item.platform !== binding.platform) {
    return null;
  }
  const primary = getSocialItemField(item, binding.defaultSourceKey);
  if (primary !== null) {
    return primary;
  }
  return binding.fallbackSourceKey ? getSocialItemField(item, binding.fallbackSourceKey) : null;
}

function labelFor(blockType: string, fieldKey: string): string {
  const binding = defaultBindings[blockType]?.find((entry) => entry.fieldKey === fieldKey);
  if (binding) {
    return binding.label;
  }
  try {
    return getBlockSpec(blockType).fields.find((field) => field.key === fieldKey)?.label ?? fieldKey;
  } catch {
    return fieldKey;
  }
}

/**
 * Resolve a block's bound fields from a SINGLE upstream item. Returns new
 * settings with every blank bound field filled from this item, or `null` when
 * the item cannot supply a required value (e.g. a Reddit item feeding a Twitter
 * block) so the caller can skip it instead of failing the whole node. Fields
 * with a static value are left intact.
 */
export function resolveInputBoundSettingsForItem(
  blockType: string,
  settings: Record<string, unknown>,
  item: SocialItem
): Record<string, unknown> | null {
  const keys = boundFieldKeys(blockType, settings);
  if (keys.length === 0) {
    return settings;
  }
  const userBindings = readBindings(settings);

  let resolved = settings;
  for (const fieldKey of keys) {
    if (!isBlank(settings[fieldKey])) {
      continue;
    }
    const value = resolveFieldFromItem(blockType, fieldKey, userBindings, item);
    if (value === null) {
      return null;
    }
    if (resolved === settings) {
      resolved = { ...settings };
    }
    resolved[fieldKey] = value;
  }
  return resolved;
}

/**
 * Resolve a block's bound fields from the FIRST upstream item that can supply
 * each (the single-call counterpart to {@link resolveInputBoundSettingsForItem}).
 * Throws when a blank bound field has no upstream value to fill it.
 */
export function resolveInputBoundSettings(
  blockType: string,
  settings: Record<string, unknown>,
  inputItems: SocialItem[]
): Record<string, unknown> {
  const keys = boundFieldKeys(blockType, settings);
  if (keys.length === 0) {
    return settings;
  }
  const userBindings = readBindings(settings);

  let resolved = settings;
  for (const fieldKey of keys) {
    if (!isBlank(settings[fieldKey])) {
      continue;
    }
    const value = firstInputValue(inputItems, blockType, fieldKey, userBindings);
    if (!value) {
      throw new Error(`${labelFor(blockType, fieldKey)} could not be resolved from upstream output`);
    }
    if (resolved === settings) {
      resolved = { ...settings };
    }
    resolved[fieldKey] = value;
  }
  return resolved;
}

function firstInputValue(
  items: SocialItem[],
  blockType: string,
  fieldKey: string,
  userBindings: Record<string, string>
): string | null {
  for (const item of items) {
    const value = resolveFieldFromItem(blockType, fieldKey, userBindings, item);
    if (value) {
      return value;
    }
  }
  return null;
}
