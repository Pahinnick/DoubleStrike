import type { DragEvent } from 'react'
import type { Board } from '../state/types'
import { getInPageDragData, setInPageDragData } from './inPageDrag'

const DRAG_MIME_TYPE = 'application/x-deck-card'

// `board: null` means the card isn't in the deck yet (dragged from a search result) — the drop
// target must add it rather than just recategorizing an existing entry.
type DraggedCard = { scryfallId: string; board: Board | null }

// Goes through inPageDrag so a drop Chromium delivers with an empty DataTransfer still lands —
// see that module for the stuck-window state this covers.
export function setDragCardData(event: DragEvent, card: DraggedCard): void {
  setInPageDragData(event, DRAG_MIME_TYPE, card)
}

export function getDragCardData(event: DragEvent): DraggedCard | null {
  return getInPageDragData<DraggedCard>(event, DRAG_MIME_TYPE)
}
