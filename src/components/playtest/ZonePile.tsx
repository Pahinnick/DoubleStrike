import type { DragEvent, ReactNode } from 'react'
import { getGameDragData, type DraggedGameCard } from './dragGameCard'

type Props = {
  label: string
  count: number
  onClick?: () => void
  onContextMenu?: () => void
  onDropCard?: (data: DraggedGameCard) => void
  children?: ReactNode
}

/** A stacked zone (library, graveyard, exile, command): shows its top card (or a card back), its count, and accepts drops. */
function ZonePile({ label, count, onClick, onContextMenu, onDropCard, children }: Props) {
  function handleDrop(event: DragEvent) {
    event.preventDefault()
    const data = getGameDragData(event)
    if (data) onDropCard?.(data)
  }

  return (
    <div
      className="zone-pile"
      onDragOver={onDropCard ? (event) => event.preventDefault() : undefined}
      onDrop={onDropCard ? handleDrop : undefined}
    >
      <div
        className={`zone-pile__slot ${onClick ? 'is-clickable' : ''}`}
        role={onClick ? 'button' : undefined}
        tabIndex={onClick ? 0 : undefined}
        aria-label={onClick ? `${label}, ${count} cards` : undefined}
        onClick={onClick}
        onContextMenu={
          onContextMenu
            ? (event) => {
                event.preventDefault()
                onContextMenu()
              }
            : undefined
        }
        onKeyDown={
          onClick
            ? (event) => {
                if (event.key === 'Enter' || event.key === ' ') onClick()
              }
            : undefined
        }
      >
        {children ?? <span className="zone-pile__empty" />}
      </div>
      <span className="zone-pile__label">
        {label} ({count})
      </span>
    </div>
  )
}

export default ZonePile
