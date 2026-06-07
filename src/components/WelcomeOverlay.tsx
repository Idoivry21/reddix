import { useModalA11y } from '../hooks/useModalA11y';

interface WelcomeOverlayProps {
  onRun: () => void;
  onDismiss: () => void;
}

/**
 * First-run welcome. The sample flow is already loaded and valid, so the fastest
 * "aha" is a single Run CTA rather than a multi-step tour.
 */
export function WelcomeOverlay({ onRun, onDismiss }: WelcomeOverlayProps) {
  const ref = useModalA11y<HTMLDivElement>(onDismiss);
  return (
    <div
      className="scrim"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) {
          onDismiss();
        }
      }}
    >
      <div
        className="modal welcome-modal"
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="welcome-title"
        tabIndex={-1}
      >
        <div className="modal-head">
          <h3 id="welcome-title">Welcome to Reddix</h3>
          <p>
            A live automation canvas for Reddit &amp; X research. We&apos;ve loaded a sample flow that pulls
            top SaaS posts and matching tweets, filters and merges them, then exports the result.
          </p>
        </div>
        <div className="welcome-body">
          <ul className="welcome-steps">
            <li>Drag blocks from the left, wire ports to build a flow</li>
            <li>Tune any block in the inspector on the right</li>
            <li>Run it and watch live results in the console below</li>
          </ul>
        </div>
        <div className="modal-foot">
          <button className="btn btn-ghost" type="button" onClick={onDismiss}>
            Explore on my own
          </button>
          <button className="btn btn-primary" type="button" onClick={onRun}>
            Run the sample flow
          </button>
        </div>
      </div>
    </div>
  );
}
