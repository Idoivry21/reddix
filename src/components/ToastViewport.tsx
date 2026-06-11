import type { Toast } from '../hooks/useToasts';

interface ToastViewportProps {
  toasts: Toast[];
  onDismiss: (id: string) => void;
}

/**
 * Fixed top-right stack of transient notifications. Errors are assertive
 * (`role="alert"`); everything else is polite (`role="status"`). Placed above the
 * bottom console dock so the two never overlap.
 */
export function ToastViewport({ toasts, onDismiss }: ToastViewportProps) {
  if (toasts.length === 0) {
    return null;
  }
  return (
    <div className="toast-viewport" role="region" aria-label="Notifications">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`toast toast-${toast.kind}`}
          role={toast.kind === 'error' ? 'alert' : 'status'}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              onDismiss(toast.id);
            }
          }}
        >
          <span className="toast-dot" aria-hidden="true" />
          <span className="toast-msg">{toast.message}</span>
          <button
            type="button"
            className="toast-dismiss"
            aria-label="Dismiss notification"
            onClick={() => onDismiss(toast.id)}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>
      ))}
    </div>
  );
}
