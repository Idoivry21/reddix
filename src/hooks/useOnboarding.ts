import { useCallback, useState } from 'react';

const STORAGE_KEY = 'reddix-onboarded';

function readOnboarded(): boolean {
  if (typeof window === 'undefined') {
    return true;
  }
  return window.localStorage?.getItem(STORAGE_KEY) === '1';
}

/**
 * First-run flag persisted to localStorage (mirrors useTheme). `showWelcome` is
 * true until the user dismisses the welcome overlay once.
 */
export function useOnboarding(): { showWelcome: boolean; dismissOnboarding: () => void } {
  const [onboarded, setOnboarded] = useState<boolean>(readOnboarded);

  const dismissOnboarding = useCallback(() => {
    setOnboarded(true);
    window.localStorage?.setItem(STORAGE_KEY, '1');
  }, []);

  return { showWelcome: !onboarded, dismissOnboarding };
}
