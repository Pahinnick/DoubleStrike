import type { DragEvent } from 'react'
import type { Board } from '../state/types'

const DRAG_MIME_TYPE = 'application/x-deck-card'

// `board: null` means the card isn't in the deck yet (dragged from a search result) — the drop
// target must add it rather than just recategorizing an existing entry.
type DraggedCard = { scryfallId: string; board: Board | null }

export function setDragCardData(event: DragEvent, card: DraggedCard): void {
  event.dataTransfer.setData(DRAG_MIME_TYPE, JSON.stringify(card))
  event.dataTransfer.effectAllowed = 'move'
}

export function getDragCardData(event: DragEvent): DraggedCard | null {
  const raw = event.dataTransfer.getData(DRAG_MIME_TYPE)
  if (!raw) return null
  try {
    return JSON.parse(raw) as DraggedCard
  } catch {
    return null
  }
}
