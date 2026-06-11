import { useCallback, useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'reddix-theme';

function readStoredTheme(): Theme {
  if (typeof window === 'undefined') {
    return 'light';
  }
  const stored = window.localStorage?.getItem(STORAGE_KEY);
  if (stored === 'light' || stored === 'dark') {
    return stored;
  }
  if (typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    return 'dark';
  }
  return 'light';
}

/**
 * Theme state synced to <html data-theme> and persisted to localStorage. Defaults
 * to the OS preference on first load.
 */
export function useTheme(): { theme: Theme; toggleTheme: () => void } {
  const [theme, setTheme] = useState<Theme>(readStoredTheme);

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('data-theme', theme);
    }
    window.localStorage?.setItem(STORAGE_KEY, theme);
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((current) => (current === 'dark' ? 'light' : 'dark'));
  }, []);

  return { theme, toggleTheme };
}
