import type { SocialItem } from './types';

interface InputBinding {
  fieldKey: string;
  label: string;
  select: (item: SocialItem) => string | null | undefined;
}

const inputBindings: Record<string, InputBinding[]> = {
  'reddit.readPost': [
    {
      fieldKey: 'postId',
      label: 'Post ID',
      select: (item) => (item.platform === 'reddit' ? item.id : null)
    }
  ],
  'twitter.tweetDetail': [
    {
      fieldKey: 'tweetIdOrUrl',
      label: 'Tweet ID or URL',
      select: (item) => (item.platform === 'twitter' ? item.id || item.url : null)
    }
  ],
  'twitter.userProfile': [
    {
      fieldKey: 'handle',
      label: 'Handle',
      select: (item) => (item.platform === 'twitter' ? item.author : null)
    }
  ]
};

export function inputBoundFieldKeys(blockType: string): string[] {
  return (inputBindings[blockType] ?? []).map((binding) => binding.fieldKey);
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

function isBlank(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === 'string' && value.trim() === '');
}
