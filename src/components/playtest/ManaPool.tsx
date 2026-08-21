import type { MouseEvent } from 'react'
import { MANA_COLOR_KEYS, type ManaColorKey } from '../../utils/colors'

const MANA_LABELS: Record<ManaColorKey, string> = {
  W: 'White',
  U: 'Blue',
  B: 'Black',
  R: 'Red',
  G: 'Green',
  C: 'Colorless',
}

type Props = {
  mana: Partial<Record<ManaColorKey, number>>
  /** Present only for your own pool — omitting it renders a compact, read-only mirror (an
   *  opponent's board) showing just the colors currently above zero. When given, every color
   *  renders (so there's always a target to click to start a color from zero), and each pip
   *  becomes a button: left-click +1, right-click -1. */
  onChange?: (color: ManaColorKey, delta: number) => void
  /** The "I've spent it all" button, zeroing every color at once — only meaningful alongside onChange. */
  onClear?: () => void
  /** Extra class(es) appended to the root. */
  className?: string
}

/** Floating mana tracker: generated but not yet spent, easy to lose count of on a big mana turn
 *  (rituals + rocks + dorks can easily clear double digits). Real Magic empties this between
 *  turns — see gameReducer's NEXT_TURN — so this is only ever mid-turn bookkeeping, not a
 *  persistent resource. */
function ManaPool({ mana, onChange, onClear, className }: Props) {
  const interactive = !!onChange
  const colors = interactive ? MANA_COLOR_KEYS : MANA_COLOR_KEYS.filter((c) => (mana[c] ?? 0) > 0)
  if (colors.length === 0) return null

  return (
    <div
      className={`playtest__mana-pool ${interactive ? '' : 'is-readonly'} ${className ?? ''}`}
      role="group"
      aria-label="Floating mana"
    >
      {colors.map((color) => {
        const value = mana[color] ?? 0
        const label = `Floating ${MANA_LABELS[color]} mana`
        if (!interactive) {
          return (
            <span key={color} className={`playtest__mana-pip playtest__mana-pip--${color.toLowerCase()}`} title={label} aria-label={`${label}: ${value}`}>
              {value}
            </span>
          )
        }
        function handleContextMenu(event: MouseEvent) {
          event.preventDefault()
          onChange!(color, -1)
        }
        return (
          <button
            key={color}
            type="button"
            className={`playtest__mana-pip playtest__mana-pip--${color.toLowerCase()} ${value === 0 ? 'is-empty' : ''}`}
            onClick={() => onChange!(color, 1)}
            onContextMenu={handleContextMenu}
            title={`${label}: left-click +1, right-click -1`}
            aria-label={`${label}: ${value}`}
          >
            {value}
          </button>
        )
      })}
      {interactive && onClear && (
        <button
          type="button"
          className="playtest__mana-pool-clear"
          onClick={onClear}
          title="Clear all floating mana"
          aria-label="Clear all floating mana"
        >
          ×
        </button>
      )}
    </div>
  )
}

export default ManaPool
