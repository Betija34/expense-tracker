import './ConfirmModal.css'

/**
 * ConfirmModal — React-based replacement for window.confirm().
 *
 * Why this exists: Firefox can silently suppress window.confirm() after
 * the page has triggered a few dialogs in a session (sometimes auto-
 * ticking "Prevent this page from creating additional dialogs"). Once
 * that happens, EVERY subsequent confirm call returns false instantly
 * with no visible UI — and the only fix is closing the tab. This
 * blocked the Bank Parser delete flow on 2026-05-31 until we discovered
 * the root cause via DevTools instrumentation.
 *
 * This modal lives entirely in our React DOM, so the browser can't
 * suppress it. Use via the `askConfirm()` helper in lib/confirm.js for
 * a near-drop-in replacement of the old `window.confirm()` calls.
 *
 * Props:
 *   open        — boolean, show/hide the modal
 *   title       — short heading
 *   message     — main text body (can include \n for line breaks)
 *   details     — optional array of strings to render as bullet list
 *   confirmText — label for the confirm button (default 'Confirm')
 *   cancelText  — label for the cancel button (default 'Cancel')
 *   variant     — 'danger' | 'primary' (controls confirm button color)
 *   onConfirm   — callback when user clicks confirm
 *   onCancel    — callback when user clicks cancel or backdrop
 */
export function ConfirmModal({
  open,
  title,
  message,
  details,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  variant = 'primary',
  onConfirm,
  onCancel,
}) {
  if (!open) return null

  // Escape key cancels; Enter confirms. Bound at the overlay level so the
  // modal is keyboard-accessible without trapping focus globally.
  const onKey = (e) => {
    if (e.key === 'Escape') onCancel?.()
    if (e.key === 'Enter')  onConfirm?.()
  }

  // Click on the dark backdrop cancels. Clicks inside the dialog itself
  // are stopped so they don't bubble up to the backdrop handler.
  return (
    <div
      className="confirm-modal-overlay"
      onClick={onCancel}
      onKeyDown={onKey}
      tabIndex={-1}
    >
      <div
        className="confirm-modal-dialog"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="confirm-modal-title">{title}</div>
        <div className="confirm-modal-message">
          {String(message || '').split('\n').map((line, i) => (
            <div key={i}>{line || ' '}</div>
          ))}
        </div>
        {details && details.length > 0 && (
          <ul className="confirm-modal-details">
            {details.map((d, i) => <li key={i}>{d}</li>)}
          </ul>
        )}
        <div className="confirm-modal-actions">
          <button
            type="button"
            className="confirm-modal-btn confirm-modal-cancel"
            onClick={onCancel}
            autoFocus
          >
            {cancelText}
          </button>
          <button
            type="button"
            className={`confirm-modal-btn confirm-modal-confirm confirm-modal-${variant}`}
            onClick={onConfirm}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  )
}
