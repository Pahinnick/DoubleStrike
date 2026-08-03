import type { CSSProperties, MouseEvent } from 'react'
import type { PtCounterPile } from '../../net/protocol'
import { formatSigned, swatchFor } from './counterFormat'

type Props = {
  items: PtCounterPile[]
  side: 'left' | 'right'
  /** Present only for your own battlefield cards — omitting it renders a static, non-interactive
   *  stack. Power and toughness move independently (see gameReducer's ADJUST_PT_COUNTER_PILE doc)
   *  so a default +1/+1 pile can be nudged to an asymmetric bonus like +1/+0 for an Equipment. */
  onAdjust?: (pileId: string, powerDelta: number, toughnessDelta: number) => void
  onRemove?: (pileId: string) => void
}

/** Power/toughness counterpart to CounterPileStack — same chip look and left/right-click
 *  interaction, but the power and toughness numbers are each their own click target (left: +1,
 *  right: -1) instead of one shared control, since a P/T pile can be (and often should be able to
 *  become) asymmetric. */
function PtCounterPileStack({ items, side, onAdjust, onRemove }: Props) {
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
          onMouseDown={interactive ? stop : undefined}
        >
          <span className="playtest-card__counter-pile-value">
            <span
              className="playtest-card__counter-pile-stat"
              title={interactive ? 'Power — left-click: +1 · right-click: -1' : undefined}
              onClick={
                interactive
                  ? (event) => {
                      stop(event)
                      onAdjust!(item.id, 1, 0)
                    }
                  : undefined
              }
              onContextMenu={
                interactive
                  ? (event) => {
                      event.preventDefault()
                      stop(event)
                      onAdjust!(item.id, -1, 0)
                    }
                  : undefined
              }
            >
              {formatSigned(item.power)}
            </span>
            /
            <span
              className="playtest-card__counter-pile-stat"
              title={interactive ? 'Toughness — left-click: +1 · right-click: -1' : undefined}
              onClick={
                interactive
                  ? (event) => {
                      stop(event)
                      onAdjust!(item.id, 0, 1)
                    }
                  : undefined
              }
              onContextMenu={
                interactive
                  ? (event) => {
                      event.preventDefault()
                      stop(event)
                      onAdjust!(item.id, 0, -1)
                    }
                  : undefined
              }
            >
              {formatSigned(item.toughness)}
            </span>
          </span>
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

export default PtCounterPileStack
