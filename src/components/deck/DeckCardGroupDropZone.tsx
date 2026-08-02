import { useState, type ReactNode } from 'react'
import type { Board } from '../../state/types'
import { getDragCardData } from '../../utils/dragCard'

type Props = {
  /** Only category groups are valid drop targets — dropping elsewhere would silently do nothing meaningful. */
  active: boolean
  /** `board` is null when the card was dragged in from search and isn't in the deck yet. */
  onDropCard: (scryfallId: string, board: Board | null) => void
  children: ReactNode
}

function DeckCardGroupDropZone({ active, onDropCard, children }: Props) {
  const [isDragOver, setIsDragOver] = useState(false)

  if (!active) return <>{children}</>

  return (
    <div
      className={`deck-card-group__dropzone ${isDragOver ? 'is-drag-over' : ''}`}
      onDragOver={(event) => {
        event.preventDefault()
        setIsDragOver(true)
      }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={(event) => {
        event.preventDefault()
        setIsDragOver(false)
        const dragged = getDragCardData(event)
        if (dragged) onDropCard(dragged.scryfallId, dragged.board)
      }}
    >
      {children}
    </div>
  )
}

export default DeckCardGroupDropZone
