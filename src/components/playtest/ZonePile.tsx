import type { DragEvent, MouseEvent, ReactNode } from 'react'
import { getGameDragData, type DraggedGameCard } from './dragGameCard'

type Props = {
  label: string
  count: number
  onClick?: () => void
  /** Right-click: the zone's own action menu (see PlaytestView's zoneActions), opened at the click. */
  onContextMenu?: (event: MouseEvent) => void
  onDropCard?: (data: DraggedGameCard) => void
  /** Currently only wired up for the library pile — see PlaytestView's libraryHovered, which the
   *  F-key "flip top of library" shortcut targets the same way Delete targets hoveredInstanceId. */
  onMouseEnter?: () => void
  onMouseLeave?: () => void
  tutorialId?: string
  children?: ReactNode
}

/** A stacked zone (library, graveyard, exile, command): shows its top card (or a card back), its count, and accepts drops. */
function ZonePile({ label, count, onClick, onContextMenu, onDropCard, onMouseEnter, onMouseLeave, tutorialId, children }: Props) {
  function handleDrop(event: DragEvent) {
    event.preventDefault()
    const data = getGameDragData(event)
    if (data) onDropCard?.(data)
  }

  return (
    <div
      className="zone-pile"
      data-tutorial-id={tutorialId}
      onDragOver={onDropCard ? (event) => event.preventDefault() : undefined}
      onDrop={onDropCard ? handleDrop : undefined}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
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
                onContextMenu(event)
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
