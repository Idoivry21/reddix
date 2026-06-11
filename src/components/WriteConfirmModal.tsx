import type { WriteSummary } from '../shared/writeActions';

interface WriteConfirmModalProps {
  writes: WriteSummary[];
  onConfirm: () => void;
  onCancel: () => void;
}

/** Per-run confirmation gate: lists every write a manual run is about to fire and
 *  flags irreversible ones. One confirm button; cancel sends nothing. */
export function WriteConfirmModal({ writes, onConfirm, onCancel }: WriteConfirmModalProps) {
  const destructiveCount = writes.filter((write) => write.destructive).length;
  return (
    <div className="scrim">
      <div className="modal" role="dialog" aria-modal="true" aria-label="Confirm write actions">
        <div className="modal-head">
          <h3>
            Confirm {writes.length} write {writes.length === 1 ? 'action' : 'actions'}
          </h3>
          <p>This run will perform authenticated write actions on your accounts. Re-runs repeat them.</p>
        </div>
        <div className="modal-body">
          <ul className="write-confirm-list">
            {writes.map((write) => (
              <li key={write.blockId} className={write.destructive ? 'write-row destructive' : 'write-row'}>
                <span className="write-action">{write.label}</span>
                <span className="write-target">
                  {write.fromUpstream ? 'per upstream item' : (write.target ?? '—')}
                </span>
                {write.destructive ? <span className="write-badge">irreversible</span> : null}
              </li>
            ))}
          </ul>
          {destructiveCount > 0 ? (
            <p className="write-warning">{destructiveCount} action(s) cannot be undone.</p>
          ) : null}
        </div>
        <div className="modal-foot">
          <button type="button" className="btn btn-sm" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary btn-sm" onClick={onConfirm}>
            Run writes
          </button>
        </div>
      </div>
    </div>
  );
}
