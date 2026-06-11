/**
 * The backend scheduler stores an interval (ms), not a cron expression, and
 * enforces a 15-minute floor. This module maps the cron-preset UI onto a
 * concrete, clamped interval the backend accepts, and best-effort parses common
 * custom cron cadences so a typed-in expression isn't silently ignored.
 */
import { MIN_SCHEDULE_INTERVAL_MS } from './shared/schedule';

export { MIN_SCHEDULE_INTERVAL_MS };

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
// Fixed 30-day approximation used as a coarse interval — NOT a calendar month.
// describeInterval's `ms === MONTH` equality check depends on this exact value.
const MONTH = 30 * DAY;

export interface CadencePreset {
  id: string;
  title: string;
  cron: string;
  intervalMs: number;
  /** Human-readable description; the single source for cronExplain. */
  explain?: string;
}

export const SCHEDULE_PRESETS: CadencePreset[] = [
  { id: 'hourly', title: 'Every hour', cron: '0 * * * *', intervalMs: HOUR, explain: 'Runs at the top of every hour.' },
  { id: 'daily', title: 'Daily · 9:00', cron: '0 9 * * *', intervalMs: DAY, explain: 'Runs every day at 09:00.' },
  { id: 'weekdays', title: 'Weekdays · 8:00', cron: '0 8 * * 1-5', intervalMs: DAY, explain: 'Runs Monday–Friday at 08:00.' },
  { id: 'weekly', title: 'Mondays · 9:00', cron: '0 9 * * 1', intervalMs: WEEK, explain: 'Runs every Monday at 09:00.' },
  { id: 'monthly', title: '1st of month', cron: '0 9 1 * *', intervalMs: MONTH, explain: 'Runs on the 1st of each month at 09:00.' },
  { id: 'custom', title: 'Custom', cron: '', intervalMs: DAY }
];

const PRESET_BY_CRON = new Map(SCHEDULE_PRESETS.filter((preset) => preset.cron).map((preset) => [preset.cron, preset]));

// Reverse of PRESET_BY_CRON for interval→cron reconstruction. The FIRST preset
// for a given interval wins, so a shared interval (DAY is both "daily" and
// "weekdays") resolves to the earlier, more generic preset rather than the later.
const CRON_BY_INTERVAL = SCHEDULE_PRESETS.reduce<Map<number, string>>((map, preset) => {
  if (preset.cron && !map.has(preset.intervalMs)) {
    map.set(preset.intervalMs, preset.cron);
  }
  return map;
}, new Map());

/** Never schedule faster than the backend's minimum interval. */
export function clampInterval(intervalMs: number): number {
  return Math.max(MIN_SCHEDULE_INTERVAL_MS, Math.round(intervalMs));
}

/**
 * Best-effort interpretation of common 5-field cron cadences. Returns null when
 * the expression isn't one of the recognised shapes (caller falls back).
 */
export function parseCronIntervalMs(cron: string): number | null {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) {
    return null;
  }
  const [minute, hour, dom, , dow] = parts;
  const everyMinutes = /^\*\/(\d+)$/.exec(minute);
  if (everyMinutes && hour === '*') {
    return Number(everyMinutes[1]) * MINUTE;
  }
  const everyHours = /^\*\/(\d+)$/.exec(hour);
  if (everyHours && /^\d+$/.test(minute)) {
    return Number(everyHours[1]) * HOUR;
  }
  if (/^\d+$/.test(minute) && /^\d+$/.test(hour)) {
    if (dom !== '*') {
      return MONTH;
    }
    if (dow !== '*') {
      return WEEK;
    }
    return DAY;
  }
  return null;
}

/** Resolve a cron expression to a clamped interval, defaulting to daily. */
export function cronToIntervalMs(cron: string): number {
  const preset = PRESET_BY_CRON.get(cron.trim());
  if (preset) {
    return clampInterval(preset.intervalMs);
  }
  return clampInterval(parseCronIntervalMs(cron) ?? DAY);
}

/**
 * Reconstruct a cron expression from a persisted interval — the inverse of
 * cronToIntervalMs — so reopening a saved flow restores its real cadence instead
 * of a hardcoded default (finding #7). A preset interval resolves to its preset
 * cron (which the modal can highlight via presetForCron); a non-preset interval
 * is synthesised as a `*​/N` cron that round-trips through cronToIntervalMs.
 *
 * Inherent lossiness (finding #6): distinct cadences that collapse to the same
 * stored interval — "weekdays" and "daily" are both a 24h interval — are
 * indistinguishable once persisted, so the more generic preset is chosen.
 */
export function intervalToCron(intervalMs: number): string {
  const clamped = clampInterval(intervalMs);
  const preset = CRON_BY_INTERVAL.get(clamped);
  if (preset) {
    return preset;
  }
  if (clamped < HOUR) {
    return `*/${Math.round(clamped / MINUTE)} * * * *`;
  }
  if (clamped < DAY && clamped % HOUR === 0) {
    return `0 */${clamped / HOUR} * * *`;
  }
  // Coarser non-preset intervals (multi-day) fall back to a daily cron rather
  // than inventing an unsupported expression; describeInterval still shows the
  // true effective cadence to the user.
  return '0 9 * * *';
}

/** Find the preset matching a cron expression (for highlighting in the UI). */
export function presetForCron(cron: string): CadencePreset | undefined {
  return PRESET_BY_CRON.get(cron.trim());
}

/** Human-readable effective cadence for a clamped interval (UI transparency). */
export function describeInterval(intervalMs: number): string {
  const ms = clampInterval(intervalMs);
  if (ms < HOUR) {
    return `every ${Math.round(ms / MINUTE)} min`;
  }
  if (ms < DAY) {
    const hours = Math.round(ms / HOUR);
    return hours === 1 ? 'hourly' : `every ${hours} hr`;
  }
  if (ms === DAY) {
    return 'daily';
  }
  if (ms === WEEK) {
    return 'weekly';
  }
  if (ms === MONTH) {
    return 'monthly';
  }
  return `every ${Math.round(ms / DAY)} days`;
}

export function cronExplain(cron: string): string {
  return (
    PRESET_BY_CRON.get(cron.trim())?.explain ??
    'Custom schedule — five fields: minute hour day month weekday.'
  );
}
