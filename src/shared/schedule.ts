/**
 * Minimum gap between scheduled runs (ms). Single source of truth shared by the
 * UI cadence mapper (src/scheduleCadence.ts) and the backend scheduler
 * (server/routes.ts) so the throttling floor can never drift between the two.
 */
export const MIN_SCHEDULE_INTERVAL_MS = 15 * 60 * 1000;

/** Longest accepted schedule interval. Keeps scheduler timestamps inside Date's
 * valid range while still allowing annual-ish cadences. */
export const MAX_SCHEDULE_INTERVAL_MS = 366 * 24 * 60 * 60 * 1000;
