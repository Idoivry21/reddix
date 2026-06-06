import { describe, expect, it } from 'vitest';
import {
  clampInterval,
  cronExplain,
  cronToIntervalMs,
  describeInterval,
  MIN_SCHEDULE_INTERVAL_MS,
  parseCronIntervalMs,
  presetForCron,
  SCHEDULE_PRESETS
} from '../src/scheduleCadence';

describe('scheduleCadence', () => {
  it('maps known cron presets to their interval', () => {
    expect(cronToIntervalMs('0 * * * *')).toBe(60 * 60 * 1000);
    expect(cronToIntervalMs('0 9 * * 1')).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it('defaults an unparseable cron to a daily interval', () => {
    expect(cronToIntervalMs('totally invalid')).toBe(24 * 60 * 60 * 1000);
  });

  it('never returns an interval below the backend minimum', () => {
    expect(clampInterval(1000)).toBe(MIN_SCHEDULE_INTERVAL_MS);
    expect(clampInterval(60 * 60 * 1000)).toBe(60 * 60 * 1000);
  });

  it('finds the preset for a cron expression', () => {
    expect(presetForCron('0 8 * * 1-5')?.id).toBe('weekdays');
    expect(presetForCron('not a cron')).toBeUndefined();
  });

  it('explains known and unknown crons', () => {
    expect(cronExplain('0 9 * * *')).toMatch(/every day at 09:00/i);
    expect(cronExplain('weird')).toMatch(/custom schedule/i);
  });

  it('every preset except custom carries a cron and interval', () => {
    for (const preset of SCHEDULE_PRESETS.filter((p) => p.id !== 'custom')) {
      expect(preset.cron).not.toBe('');
      expect(preset.intervalMs).toBeGreaterThanOrEqual(MIN_SCHEDULE_INTERVAL_MS);
    }
  });

  it('parses common custom cron cadences instead of silently defaulting', () => {
    expect(parseCronIntervalMs('*/30 * * * *')).toBe(30 * 60 * 1000);
    expect(parseCronIntervalMs('0 */2 * * *')).toBe(2 * 60 * 60 * 1000);
    expect(parseCronIntervalMs('0 9 1 * *')).toBe(30 * 24 * 60 * 60 * 1000);
    expect(parseCronIntervalMs('0 9 * * 1')).toBe(7 * 24 * 60 * 60 * 1000);
    expect(parseCronIntervalMs('garbage')).toBeNull();
  });

  it('clamps a sub-minimum custom cadence up to the floor', () => {
    // */5 = 5 min, below the 15-min floor → clamped.
    expect(cronToIntervalMs('*/5 * * * *')).toBe(MIN_SCHEDULE_INTERVAL_MS);
  });

  it('describes the effective cadence for the UI', () => {
    expect(describeInterval(60 * 60 * 1000)).toBe('hourly');
    expect(describeInterval(24 * 60 * 60 * 1000)).toBe('daily');
    expect(describeInterval(7 * 24 * 60 * 60 * 1000)).toBe('weekly');
    expect(describeInterval(2 * 60 * 60 * 1000)).toBe('every 2 hr');
  });
});
