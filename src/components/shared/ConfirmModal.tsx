import type { MouseEvent } from 'react'
import { useEscapeToClose } from '../../hooks/useEscapeToClose'
import './confirmModal.css'

type Props = {
  title: string
  message: string
  confirmLabel?: string
  onConfirm: () => void
  onCancel: () => void
}

function ConfirmModal({ title, message, confirmLabel = 'Delete', onConfirm, onCancel }: Props) {
  useEscapeToClose(onCancel)
  // Nested inside the modal it's confirming a delete from — stop the click here so it
  // doesn't also bubble up and dismiss that parent overlay.
  function handleBackdropClick(event: MouseEvent) {
    event.stopPropagation()
    onCancel()
  }

  return (
    <div className="modal-overlay confirm-modal-overlay" role="dialog" aria-modal="true" aria-label={title} onClick={handleBackdropClick}>
      <div className="modal-content confirm-modal" onClick={(event) => event.stopPropagation()}>
        <h2>{title}</h2>
        <p>{message}</p>
        <div className="confirm-modal__actions">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="confirm-modal__confirm" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

export default ConfirmModal
