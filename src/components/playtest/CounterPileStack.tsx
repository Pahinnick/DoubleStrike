import type { CSSProperties, MouseEvent } from 'react'
import type { CounterColor } from '../../net/protocol'
import { swatchFor } from './counterFormat'

export type CounterPileItem = {
  id: string
  color: CounterColor
  /** Pre-formatted display text — the stack itself doesn't know generic vs power/toughness. */
  text: string
}

type Props = {
  items: CounterPileItem[]
  side: 'left' | 'right'
  /** Present only for your own battlefield cards — omitting it renders a static, non-interactive stack. */
  onAdjust?: (pileId: string, delta: number) => void
  onRemove?: (pileId: string) => void
}

/** Vertical stack of colored counter-pile chips anchored to a battlefield card's left or right
 *  edge, ~1/3 of the way down (by the card art, not the text box). Each chip always shows its
 *  color and value; left-click adds one, right-click removes one — the right-click "Add Counter"
 *  menu (on the card itself, not the chip) is the only other way to create or delete a pile;
 *  hovering a chip reveals a small × to delete the whole pile at once. */
function CounterPileStack({ items, side, onAdjust, onRemove }: Props) {
  if (items.length === 0) return null
  const interactive = !!onAdjust

  function stop(event: MouseEvent) {
    event.stopPropagation()
  }

  return (
    <div className={`playtest-card__counter-stack playtest-card__counter-stack--${side}`}>
      {items.map((item) => (
        <div
          key={item.id}
          className={`playtest-card__counter-pile ${interactive ? 'playtest-card__counter-pile--interactive' : ''}`}
          style={{ '--pile-color': swatchFor(item.color) } as CSSProperties}
          title={interactive ? 'Left-click: +1 · Right-click: -1' : undefined}
          onMouseDown={interactive ? stop : undefined}
          onClick={
            interactive
              ? (event) => {
                  stop(event)
                  onAdjust!(item.id, 1)
                }
              : undefined
          }
          onContextMenu={
            interactive
              ? (event) => {
                  event.preventDefault()
                  stop(event)
                  onAdjust!(item.id, -1)
                }
              : undefined
          }
        >
          <span className="playtest-card__counter-pile-value">{item.text}</span>
          {interactive && onRemove && (
            <span className="playtest-card__counter-pile-controls">
              <button
                type="button"
                className="playtest-card__counter-pile-remove"
                title="Remove this counter pile"
                onClick={(event) => {
                  stop(event)
                  onRemove(item.id)
                }}
              >
                ×
              </button>
            </span>
          )}
        </div>
      ))}
    </div>
  )
}

export default CounterPileStack
