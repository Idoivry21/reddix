import { useState } from 'react';
import { cronExplain, cronToIntervalMs, describeInterval, presetForCron, SCHEDULE_PRESETS } from '../scheduleCadence';
import { useModalA11y } from '../hooks/useModalA11y';

export interface ScheduleDraft {
  enabled: boolean;
  cron: string;
}

export interface SavedSchedule {
  enabled: boolean;
  cron: string;
  intervalMs: number;
}

interface ScheduleModalProps {
  schedule: ScheduleDraft;
  onClose: () => void;
  onSave: (schedule: SavedSchedule) => void;
}

export function ScheduleModal({ schedule, onClose, onSave }: ScheduleModalProps) {
  const [cron, setCron] = useState(schedule.cron || '0 9 * * 1');
  const [enabled, setEnabled] = useState(schedule.enabled);
  const matched = presetForCron(cron);
  const dialogRef = useModalA11y<HTMLDivElement>(onClose);

  return (
    <div className="scrim" onPointerDown={onClose}>
      <div
        ref={dialogRef}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="Schedule this flow"
        tabIndex={-1}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="modal-head">
          <h3>Schedule this flow</h3>
          <p>
            Reddix runs the flow on this cadence and drops fresh results into your export targets. The CLIs run headless on the
            schedule.
          </p>
        </div>
        <div className="modal-body">
          <div className="field-label" style={{ marginBottom: 8 }}>
            Cadence
          </div>
          <div className="cron-presets">
            {SCHEDULE_PRESETS.map((preset) => {
              const isOn = matched ? matched.id === preset.id : preset.id === 'custom';
              return (
                <button
                  key={preset.id}
                  type="button"
                  className={`cron-preset ${isOn ? 'on' : ''}`}
                  onClick={() => preset.cron && setCron(preset.cron)}
                >
                  <div className="cp-title">{preset.title}</div>
                  <div className="cp-cron">{preset.cron || 'set below'}</div>
                </button>
              );
            })}
          </div>
          <div className="field">
            <label className="field-label" htmlFor="schedule-cron">
              Cron expression
            </label>
            <input
              id="schedule-cron"
              className="input mono"
              value={cron}
              onChange={(event) => setCron(event.target.value)}
              placeholder="0 9 * * 1"
            />
            <div className="field-hint">
              {cronExplain(cron)} Effective cadence: <strong>{describeInterval(cronToIntervalMs(cron))}</strong>
              {enabled ? '' : ' (paused)'}.
            </div>
          </div>
          <label className="schedule-toggle">
            <button
              type="button"
              className={`mini-toggle ${enabled ? 'on' : ''}`}
              role="switch"
              aria-checked={enabled}
              aria-label="Schedule enabled"
              onClick={() => setEnabled((current) => !current)}
            >
              <span className="mini-knob" />
            </button>
            <span className="schedule-toggle-label">{enabled ? 'Schedule enabled' : 'Schedule paused'}</span>
          </label>
        </div>
        <div className="modal-foot">
          <button className="btn btn-sm" type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary btn-sm"
            type="button"
            onClick={() => onSave({ enabled, cron, intervalMs: cronToIntervalMs(cron) })}
          >
            Save schedule
          </button>
        </div>
      </div>
    </div>
  );
}
