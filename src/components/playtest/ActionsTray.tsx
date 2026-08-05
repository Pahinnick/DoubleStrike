import { useState, type MouseEvent } from 'react'

export type TrayAction = {
  key: string
  label: string
  icon: string
  onClick: (event: MouseEvent<HTMLButtonElement>) => void
  tutorialId?: string
}

type Props = {
  actions: TrayAction[]
  /** When set (tutorial in progress), fully overrides the user's own open/closed toggle —
   *  true forces the tray open for a step that points inside it, false forces it shut on
   *  every other step so it doesn't linger open. undefined (no tour running) leaves normal
   *  click-to-toggle behavior alone. */
  forceOpen?: boolean
}

/** Slide-out drawer of common game actions (scry, surveil, cascade, tutor, shuffle), tucked above the hand. */
function ActionsTray({ actions, forceOpen }: Props) {
  const [open, setOpen] = useState(false)
  const isOpen = forceOpen ?? open

  return (
    <div className="playtest__actions-wrap">
      <button
        type="button"
        className="playtest__actions-tab"
        data-tutorial-id="actions-button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={isOpen}
      >
        Actions
      </button>
      <div className={`playtest__actions-tray ${isOpen ? 'is-open' : ''}`}>
        {actions.map((action) => (
          <button
            key={action.key}
            type="button"
            className="playtest__actions-icon"
            data-tutorial-id={action.tutorialId}
            aria-label={action.label}
            onClick={action.onClick}
          >
            <span aria-hidden="true">{action.icon}</span>
            <span className="playtest__actions-tooltip" role="tooltip">
              {action.label}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

export default ActionsTray
