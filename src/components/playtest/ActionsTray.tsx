import { useState, type MouseEvent } from 'react'

export type TrayAction = {
  key: string
  label: string
  icon: string
  onClick: (event: MouseEvent<HTMLButtonElement>) => void
}

type Props = {
  actions: TrayAction[]
}

/** Slide-out drawer of common game actions (scry, surveil, cascade, tutor, shuffle), tucked above the hand. */
function ActionsTray({ actions }: Props) {
  const [open, setOpen] = useState(false)

  return (
    <div className="playtest__actions-wrap">
      <button type="button" className="playtest__actions-tab" onClick={() => setOpen((prev) => !prev)} aria-expanded={open}>
        Actions
      </button>
      <div className={`playtest__actions-tray ${open ? 'is-open' : ''}`}>
        {actions.map((action) => (
          <button
            key={action.key}
            type="button"
            className="playtest__actions-icon"
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
