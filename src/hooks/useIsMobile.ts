import { useEffect, useState } from 'react';

/** Spec: at/below this width the workbench is a read-only monitor. */
export const MOBILE_BREAKPOINT_PX = 900;

const query = `(max-width: ${MOBILE_BREAKPOINT_PX}px)`;

/**
 * True when the viewport is at or below the mobile breakpoint. Mobile is a
 * monitor-only surface by design, so authoring actions are disabled there.
 */
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return false;
    }
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }
    const media = window.matchMedia(query);
    const onChange = (): void => setIsMobile(media.matches);
    onChange();
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  return isMobile;
}
