import { useState } from 'react'

type Props = {
  emojis: readonly string[]
  onSend: (emoji: string) => void
}

/** Slide-out popover of one-click emoji reactions, tucked behind a single tab — same pattern as
 *  ActionsTray, replacing the old always-visible row that crowded the quickbar as it grew.
 *  Unlike ActionsTray (repeatable utility actions, stays open across clicks), a reaction is a
 *  one-shot send, so picking one closes the tray right away. */
function ReactionsTray({ emojis, onSend }: Props) {
  const [open, setOpen] = useState(false)

  return (
    <div className="playtest__reactions-wrap">
      <button
        type="button"
        className="playtest__reactions-tab"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-label="Send a reaction"
      >
        🙂
      </button>
      <div className={`playtest__reactions-tray ${open ? 'is-open' : ''}`} role="group" aria-label="Send a reaction">
        {emojis.map((emoji) => (
          <button
            key={emoji}
            type="button"
            className="playtest__reaction-btn"
            onClick={() => {
              onSend(emoji)
              setOpen(false)
            }}
            aria-label={`React with ${emoji}`}
          >
            {emoji}
          </button>
        ))}
      </div>
    </div>
  )
}

export default ReactionsTray
