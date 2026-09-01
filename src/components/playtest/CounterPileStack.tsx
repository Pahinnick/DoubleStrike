import type { CSSProperties, DragEvent, MouseEvent } from 'react'
import type { CounterColor } from '../../net/protocol'
import { swatchFor } from './counterFormat'
import { setCounterDragData } from './dragCounterPile'

export type CounterPileItem = {
  id: string
  color: CounterColor
  /** Pre-formatted display text — the stack itself doesn't know generic vs power/toughness. */
  text: string
  /** Optional full name shown in the tooltip ahead of the click hint (e.g. "Flying") — omitted
   *  for freeform color piles, which have no inherent meaning. */
  name?: string
}

type Props = {
  items: CounterPileItem[]
  side: 'left' | 'right'
  /** The battlefield card these piles live on — only needed to tag an outgoing drag with where
   *  it came from (see `sourceInstanceId` doc below); a static stack has nothing to drag. */
  sourceInstanceId?: string
  /** Present only for your own battlefield cards — omitting it renders a static, non-interactive stack. */
  onAdjust?: (pileId: string, delta: number) => void
  onRemove?: (pileId: string) => void
  /** Grows/shrinks the whole stack (chips, gaps, text), and how deep it perches onto the card's
   *  edge, together — used by CardHoverPreview so the pile chips track the enlarged card image
   *  (Alt+scroll) instead of staying a fixed on-screen size while the card around them grows or
   *  shrinks. The stack's own `top` (see playtest.css) is a percentage of the card, already
   *  responsive to that scaling on its own; `right`/`left`'s fixed-px component (INSET_PX below)
   *  isn't, so it's overridden here too — without that, the chips ended up looking right-sized
   *  but perched shallower onto the card than the real battlefield version the bigger the preview
   *  got, since that fixed inset became a shrinking fraction of the now-much-wider card. Omitted
   *  (not 1) for every other caller — a real battlefield card's piles always render at their one
   *  true size and inset. */
  scale?: number
}

// Matches playtest.css's own `calc(100% - 25px)` for --left/--right — kept in sync manually since
// the CSS constant can't be read from here; scale-adjusted below rather than left fixed (see
// `scale`'s doc) so the perch depth stays proportionally the same at any preview size.
const INSET_PX = 25
// A modest boost on top of pure 1:1 scale tracking — chips that matched the enlarged card exactly
// still read as a little small/washed-out next to it; nudging them slightly past proportional
// brings them closer to how prominent a real battlefield card's counters look relative to its own
// (much smaller) size.
const SCALE_BOOST = 1.2

/** Vertical stack of colored counter-pile chips anchored to a battlefield card's left or right
 *  edge, ~1/3 of the way down (by the card art, not the text box). Each chip always shows its
 *  color and value; left-click adds one, right-click removes one — the right-click "Add Counter"
 *  menu (on the card itself, not the chip) is the only other way to create or delete a pile;
 *  hovering a chip reveals a small × to delete the whole pile at once. Interactive chips are also
 *  draggable onto another of your own battlefield cards to move the whole pile there — see
 *  PlaytestView's per-card onDrop and gameReducer's MOVE_COUNTER_PILE. */
function CounterPileStack({ items, side, sourceInstanceId, onAdjust, onRemove, scale }: Props) {
  if (items.length === 0) return null
  const interactive = !!onAdjust

  function stop(event: MouseEvent) {
    event.stopPropagation()
  }

  // The edge this stack hangs off of — scaling the chips around that same edge keeps it pinned
  // there instead of drifting as the stack grows or shrinks; overriding the inset itself (see
  // INSET_PX's doc) keeps the perch depth proportional too, instead of the fixed 25px shrinking
  // to a sliver against an enlarged card.
  const effectiveScale = scale !== undefined ? scale * SCALE_BOOST : undefined
  const scaleStyle: CSSProperties | undefined =
    effectiveScale !== undefined
      ? {
          transform: `scale(${effectiveScale})`,
          transformOrigin: side === 'left' ? 'right center' : 'left center',
          [side === 'left' ? 'right' : 'left']: `calc(100% - ${INSET_PX * effectiveScale}px)`,
        }
      : undefined

  return (
    <div className={`playtest-card__counter-stack playtest-card__counter-stack--${side}`} style={scaleStyle}>
      {items.map((item) => (
        <div
          key={item.id}
          className={`playtest-card__counter-pile ${interactive ? 'playtest-card__counter-pile--interactive' : ''}`}
          style={{ '--pile-color': swatchFor(item.color) } as CSSProperties}
          title={
            interactive
              ? `${item.name ? `${item.name} — ` : ''}Left-click: +1 · Right-click: -1 · drag onto another card to move the pile there`
              : undefined
          }
          draggable={interactive && !!sourceInstanceId}
          onDragStart={
            interactive && sourceInstanceId
              ? (event: DragEvent) => {
                  stop(event)
                  setCounterDragData(event, { fromInstanceId: sourceInstanceId, pileId: item.id, kind: 'generic' })
                }
              : undefined
          }
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
