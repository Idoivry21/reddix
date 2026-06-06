import { BrandMark } from '../icons';
import { useModalA11y } from '../hooks/useModalA11y';
import type { AccentKey } from '../blockVisuals';

export interface FlowSummary {
  id: string;
  name: string;
  description: string;
  blocks: number;
  sources: AccentKey[];
  status: 'scheduled' | 'idle' | 'error';
  statusLabel: string;
}

interface DashboardProps {
  flows: FlowSummary[];
  currentId: string;
  onOpen: (id: string) => void;
  onClose: () => void;
  onNew?: () => void;
}

const DOT_COLOR: Record<FlowSummary['status'], string> = {
  scheduled: 'var(--cat-output)',
  idle: 'var(--ink-300)',
  error: 'var(--brand-600)'
};

export function Dashboard({ flows, currentId, onOpen, onClose, onNew }: DashboardProps) {
  const dialogRef = useModalA11y<HTMLDivElement>(onClose);
  return (
    <div ref={dialogRef} className="dash-scrim" role="dialog" aria-modal="true" aria-label="Flows" tabIndex={-1}>
      <div className="dash-top">
        <div className="brand">
          <div className="brand-mark">
            <BrandMark />
          </div>
          <span className="brand-name">Reddix</span>
        </div>
        <div className="topbar-spacer" />
        <button className="btn btn-sm" type="button" onClick={onClose}>
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M19 12H5M11 6l-6 6 6 6" />
          </svg>
          Back to editor
        </button>
      </div>
      <div className="dash-body">
        <div className="dash-inner">
          <h1 className="dash-h1">Flows</h1>
          <p className="dash-sub">Your saved automations across Reddit and X. Open one to edit on the canvas.</p>
          <div className="flow-grid">
            {flows.map((flow) => (
              <button className="flow-card" key={flow.id} type="button" onClick={() => onOpen(flow.id)}>
                <div className="fc-top">
                  <span className="fc-dot" style={{ background: DOT_COLOR[flow.status] }} />
                  <span className="fc-status">
                    {flow.statusLabel}
                    {flow.id === currentId ? ' · open' : ''}
                  </span>
                </div>
                <h3 className="fc-title">{flow.name}</h3>
                <div className="fc-desc">{flow.description}</div>
                <div className="fc-foot">
                  <span>{flow.blocks} blocks</span>
                  <span style={{ display: 'flex', gap: 6 }}>
                    {flow.sources.map((source) => (
                      <span key={source} className="chip-mini">
                        <span className={`mini-dot cat-${source}`} />
                        {source === 'x' ? 'X' : source}
                      </span>
                    ))}
                  </span>
                </div>
              </button>
            ))}
            <button className="flow-card new-card" type="button" onClick={onNew}>
              <div style={{ textAlign: 'center' }}>
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M12 5v14M5 12h14" />
                </svg>
                <div style={{ marginTop: 8, fontWeight: 600, fontSize: 13 }}>New flow</div>
              </div>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
